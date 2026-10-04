use std::{ffi::c_void, ptr::NonNull, sync::Arc};

use clap_sys::{
    events::{
        CLAP_EVENT_PARAM_GESTURE_BEGIN, CLAP_EVENT_PARAM_GESTURE_END, CLAP_EVENT_PARAM_VALUE,
        clap_event_param_value, clap_input_events, clap_output_events,
    },
    ext::params::clap_plugin_params,
    plugin::clap_plugin,
    process::{CLAP_PROCESS_CONTINUE, clap_process},
};
use heron_audio_plugin::{AudioPluginProcessor, AudioPortToken, ProcessContext, SidechainSource};

use super::super::{ClapParameterGesture, ClapProcessorHandle};

struct Fixture {
    raw: clap_plugin,
    params: clap_plugin_params,
    received: Vec<(u16, Option<f64>)>,
    flushes: usize,
}

struct Harness {
    // The endpoint must stop and release its raw plug-in pointer before the fixture drops.
    processor: ClapProcessorHandle,
    fixture: Box<Fixture>,
}

impl Harness {
    fn new() -> Self {
        let mut fixture = Box::new(Fixture {
            raw: clap_plugin {
                desc: std::ptr::null(),
                plugin_data: std::ptr::null_mut(),
                init: None,
                destroy: None,
                activate: None,
                deactivate: None,
                start_processing: Some(start),
                stop_processing: None,
                reset: None,
                process: Some(process),
                get_extension: Some(extension),
                on_main_thread: None,
            },
            params: clap_plugin_params {
                count: None,
                get_info: None,
                get_value: None,
                value_to_text: None,
                text_to_value: None,
                flush: Some(flush),
            },
            received: Vec::new(),
            flushes: 0,
        });
        fixture.raw.plugin_data = (&mut *fixture as *mut Fixture).cast();
        let processor = ClapProcessorHandle::new(
            NonNull::from(&mut fixture.raw),
            vec![],
            vec![],
            16,
            Arc::default(),
            Arc::default(),
            Arc::default(),
        )
        .unwrap();
        Self { processor, fixture }
    }

    fn queue_edit(&self) {
        for gesture in [
            ClapParameterGesture::Begin,
            ClapParameterGesture::Perform,
            ClapParameterGesture::End,
        ] {
            assert!(self.processor.queue_parameter(7, 0.25, gesture));
        }
    }
}

unsafe extern "C" fn extension(
    plugin: *const clap_plugin,
    _: *const std::ffi::c_char,
) -> *const c_void {
    // SAFETY: The harness retains the boxed fixture throughout every endpoint call.
    let fixture = unsafe { &*((*plugin).plugin_data.cast::<Fixture>()) };
    (&fixture.params as *const clap_plugin_params).cast()
}

unsafe fn receive(plugin: *const clap_plugin, input: *const clap_input_events) {
    // SAFETY: Host-owned input callbacks and boxed fixture stay live during flush/process.
    let (fixture, input) = unsafe { (&mut *((*plugin).plugin_data.cast::<Fixture>()), &*input) };
    // SAFETY: Heron's event list supplies size/get for the duration of the callback.
    for index in 0..unsafe { input.size.unwrap()(input) } {
        // SAFETY: The index is bounded by the event count returned by the same list.
        let event = unsafe { &*input.get.unwrap()(input, index) };
        let value = (event.type_ == CLAP_EVENT_PARAM_VALUE).then(|| {
            // SAFETY: The host emits a parameter-value event with its matching C layout.
            unsafe { (*(event as *const _ as *const clap_event_param_value)).value }
        });
        fixture.received.push((event.type_, value));
    }
}

unsafe extern "C" fn flush(
    plugin: *const clap_plugin,
    input: *const clap_input_events,
    _: *const clap_output_events,
) {
    // SAFETY: Both pointers belong to the live harness and host event list.
    unsafe { receive(plugin, input) };
    // SAFETY: The fixture is exclusively used on this test thread.
    unsafe { &mut *((*plugin).plugin_data.cast::<Fixture>()) }.flushes += 1;
}

unsafe extern "C" fn start(_: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn process(plugin: *const clap_plugin, process: *const clap_process) -> i32 {
    // SAFETY: Heron retains the process struct and its event list throughout this callback.
    unsafe { receive(plugin, (*process).in_events) };
    CLAP_PROCESS_CONTINUE
}

#[test]
fn inactive_flush_delivers_edits_without_gestures_or_replaying_them() {
    let mut harness = Harness::new();
    harness.queue_edit();
    harness.processor.flush_parameters_while_inactive().unwrap();
    assert_eq!(
        harness.fixture.received,
        [(CLAP_EVENT_PARAM_VALUE, Some(0.25))]
    );
    assert!(!harness.processor.has_pending_parameters());

    harness.processor.flush_parameters_while_inactive().unwrap();
    assert_eq!(harness.fixture.flushes, 1);
}

#[test]
fn unavailable_flush_preserves_edits_for_a_later_retry() {
    let mut harness = Harness::new();
    harness.queue_edit();
    harness.fixture.params.flush = None;
    assert!(harness.processor.flush_parameters_while_inactive().is_err());
    assert!(harness.processor.has_pending_parameters());
    assert!(harness.fixture.received.is_empty());

    harness.fixture.params.flush = Some(flush);
    harness.processor.flush_parameters_while_inactive().unwrap();
    assert_eq!(
        harness.fixture.received,
        [(CLAP_EVENT_PARAM_VALUE, Some(0.25))]
    );
}

#[test]
fn active_or_shared_endpoints_cannot_flush_or_consume_queued_edits() {
    let mut harness = Harness::new();
    harness.queue_edit();
    let registry_endpoint = harness.processor.clone();
    assert!(harness.processor.flush_parameters_while_inactive().is_err());
    assert!(harness.processor.has_pending_parameters());
    drop(registry_endpoint);

    harness
        .processor
        .lifecycle
        .store(1, std::sync::atomic::Ordering::Release);
    assert!(harness.processor.flush_parameters_while_inactive().is_err());
    assert!(harness.fixture.received.is_empty());
    assert!(harness.processor.has_pending_parameters());

    harness
        .processor
        .lifecycle
        .store(0, std::sync::atomic::Ordering::Release);
    harness.processor.flush_parameters_while_inactive().unwrap();
    assert_eq!(
        harness.fixture.received,
        [(CLAP_EVENT_PARAM_VALUE, Some(0.25))]
    );
}

struct NoSidechains;
impl SidechainSource for NoSidechains {
    fn frames(&self, _: AudioPortToken) -> Option<&[[f32; 2]]> {
        None
    }
}

#[test]
fn realtime_processing_retains_the_complete_parameter_gesture() {
    let mut harness = Harness::new();
    harness.queue_edit();
    harness
        .processor
        .lifecycle
        .store(1, std::sync::atomic::Ordering::Release);
    let context = ProcessContext {
        project_time_samples: 0,
        continuous_time_samples: 0,
        steady_time_samples: 0,
        project_time_quarters: 0.0,
        bar_position_quarters: 0.0,
        tempo: 120.0,
        time_signature_numerator: 4,
        time_signature_denominator: 4,
        playing: false,
        recording: false,
        loop_active: false,
        loop_start_quarters: 0.0,
        loop_end_quarters: 0.0,
    };
    assert!(
        harness
            .processor
            .process_block(&mut [[0.0; 2]; 16], &NoSidechains, &context)
    );
    assert_eq!(
        harness.fixture.received,
        [
            (CLAP_EVENT_PARAM_GESTURE_BEGIN, None),
            (CLAP_EVENT_PARAM_VALUE, Some(0.25)),
            (CLAP_EVENT_PARAM_GESTURE_END, None),
        ]
    );
    assert!(!harness.processor.has_pending_parameters());
}
