use super::*;
use std::sync::{Mutex, Weak};
use truce::core::editor::{ClosureBridge, EditorBridge, RawWindowHandle};

#[path = "solo_tests.rs"]
mod solo_tests;

#[path = "notice_tests.rs"]
mod notice_tests;

#[path = "state_restore_tests.rs"]
mod state_restore_tests;

#[path = "fixed_panel_tests.rs"]
mod fixed_panel;
pub(super) use fixed_panel::verify_widget_drag;

type Events = Arc<Mutex<Vec<(char, u32)>>>;

fn host(params: Arc<EqParams>, events: Events) -> Arc<dyn EditorBridge> {
    host_with_settlement(params, events, true)
}

fn host_with_settlement(
    params: Arc<EqParams>,
    events: Events,
    immediate: bool,
) -> Arc<dyn EditorBridge> {
    let begin = events.clone();
    let set = events.clone();
    let end = events.clone();
    let resize = events;
    let write = params.clone();
    let plain = params.clone();
    let read = params;
    Arc::new(ClosureBridge {
        begin_edit: Box::new(move |id| begin.lock().unwrap().push(('b', id))),
        set_param: Box::new(move |id, value| {
            if immediate {
                write.set_normalized(id, value);
            }
            set.lock().unwrap().push(('s', id));
        }),
        end_edit: Box::new(move |id| end.lock().unwrap().push(('e', id))),
        request_resize: Box::new(move |_, _| {
            resize.lock().unwrap().push(('r', 0));
            true
        }),
        get_param: Box::new(move |id| read.get_normalized(id).unwrap_or(0.0)),
        get_param_plain: Box::new(move |id| plain.get_plain(id).unwrap_or(0.0)),
        format_param: Box::new(|_| String::new()),
        get_meter: Box::new(|_| 0.0),
        get_state: Box::new(Vec::new),
        set_state: Box::new(|_| {}),
        transport: Box::new(|| None),
    })
}

/// Mimics Windows' delayed handler destruction: close keeps the context alive
/// and delivers a queued resize/parameter callback immediately after close.
struct DelayedEditor {
    context: Arc<Mutex<Option<PluginContext>>>,
}
impl Editor for DelayedEditor {
    fn size(&self) -> (u32, u32) {
        (1120, 760)
    }
    fn open(&mut self, _: RawWindowHandle, context: PluginContext) {
        *self.context.lock().unwrap() = Some(context);
    }
    fn close(&mut self) {
        if let Some(context) = self.context.lock().unwrap().as_ref() {
            context.set_param(0u32, 1.0);
            let _ = context.request_resize(1200, 800);
        }
    }
}

struct Harness {
    params: Arc<EqParams>,
    events: Events,
    window: Arc<Mutex<Option<PluginContext>>>,
    editor: wrapper::HeronEqEditor,
    raw: Weak<dyn EditorBridge>,
}
impl Harness {
    fn new() -> Self {
        Self::settlement(true)
    }
    fn settlement(immediate: bool) -> Self {
        let params = Arc::new(EqParams::default());
        let events = Events::default();
        let window = Arc::new(Mutex::new(None));
        let bridge = host_with_settlement(params.clone(), events.clone(), immediate);
        let raw = Arc::downgrade(&bridge);
        let erased: Arc<dyn Params> = params.clone();
        let mut editor = wrapper::HeronEqEditor::new(
            params.clone(),
            Box::new(DelayedEditor {
                context: window.clone(),
            }),
        );
        editor.open(
            RawWindowHandle::Win32(std::ptr::null_mut()),
            PluginContext::new(bridge, erased),
        );
        Self {
            params,
            events,
            window,
            editor,
            raw,
        }
    }
    fn context(&self) -> PluginContext<EqParams> {
        self.window
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .with_params(self.params.clone())
    }
    fn session(&self) -> Arc<session::Session> {
        session::matching(&self.context()).unwrap()
    }
}

fn fit_ui(source: &Harness) -> EqUi {
    let preset = Preset::parse(include_str!("../../tests/fixtures/fit-preset.json")).unwrap();
    for (id, value) in source.params.normalized_values(&preset.config) {
        source.params.set_normalized(id, value);
    }
    let mut ui = EqUi::new(source.params.clone());
    ui.session = Some(source.session());
    ui
}

fn dispatch(ui: &mut EqUi, source: &Harness, message: EqMessage) {
    source
        .session()
        .with_permission(|| ui.handle(message, &source.context()))
        .unwrap();
}

#[test]
fn band_hud_is_selection_driven_and_secondary_menus_are_exclusive() {
    let source = Harness::new();
    let mut ui = fit_ui(&source);
    assert!(ui.model.borrow().selected.is_empty());
    dispatch(&mut ui, &source, EqMessage::Select(1));
    dispatch(&mut ui, &source, EqMessage::Menu(Panel::BandActions));
    assert_eq!(ui.panel, Some(Panel::BandActions));
    dispatch(&mut ui, &source, EqMessage::Menu(Panel::Analyzer));
    assert_eq!(ui.panel, Some(Panel::Analyzer));
    dispatch(&mut ui, &source, EqMessage::Graph(GraphMessage::Deselect));
    assert!(ui.panel.is_none());
    assert!(ui.model.borrow().selected.is_empty());
    assert!(source.events.lock().unwrap().is_empty());
}

#[test]
fn knob_updates_balance_one_host_gesture_per_drag_or_wheel() {
    use super::knobs::KnobMessage;
    let source = Harness::new();
    let mut ui = fit_ui(&source);
    dispatch(&mut ui, &source, EqMessage::Select(1));
    let original = ui.model.borrow().focused().unwrap().gain_db;
    for message in [
        KnobMessage::Begin(Number::Gain),
        KnobMessage::Change(Number::Gain, original + 1.0),
        KnobMessage::Change(Number::Gain, original + 3.0),
        KnobMessage::End,
    ] {
        dispatch(&mut ui, &source, EqMessage::Knob(message));
    }
    let gain_id = crate::params::BAND_BASE + 4;
    let events = source.events.lock().unwrap().clone();
    assert_eq!(
        events
            .iter()
            .filter(|(kind, id)| *kind == 'b' && *id == gain_id)
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|(kind, id)| *kind == 'e' && *id == gain_id)
            .count(),
        1
    );
    assert!((ui.model.borrow().focused().unwrap().gain_db - original - 3.0).abs() < 1e-8);
    assert!(!ui.model.borrow().has_gesture());
    dispatch(
        &mut ui,
        &source,
        EqMessage::Knob(KnobMessage::Step(Number::Gain, original + 2.0)),
    );
    assert!((ui.model.borrow().focused().unwrap().gain_db - original - 2.0).abs() < 1e-8);
    assert!(!ui.model.borrow().has_gesture());
    let events = source.events.lock().unwrap();
    for kind in ['b', 'e'] {
        assert_eq!(
            events
                .iter()
                .filter(|(event, id)| *event == kind && *id == gain_id)
                .count(),
            2
        );
    }
}

#[test]
fn right_click_cancels_audition_and_unfinished_gesture_before_opening_band_menu() {
    let source = Harness::new();
    let mut ui = fit_ui(&source);
    let original = ui.model.borrow().config.bands[0].gain_db;
    dispatch(
        &mut ui,
        &source,
        EqMessage::Graph(GraphMessage::BeginDrag {
            id: 1,
            additive: false,
            solo: true,
        }),
    );
    dispatch(
        &mut ui,
        &source,
        EqMessage::Graph(GraphMessage::Drag {
            frequency_ratio: 1.0,
            gain_delta: 5.0,
        }),
    );
    dispatch(
        &mut ui,
        &source,
        EqMessage::Graph(GraphMessage::ContextMenu {
            id: 1,
            position: truce_iced::iced::Point::new(200.0, 200.0),
        }),
    );
    assert_eq!(ui.panel, Some(Panel::BandActions));
    assert!(ui.model.borrow().solo.is_none());
    assert!(!ui.transient_solo);
    assert!((ui.model.borrow().config.bands[0].gain_db - original).abs() < 1e-8);
    assert!(ui.edited.is_empty());
}

#[test]
fn numeric_input_does_not_trigger_band_delete() {
    let source = Harness::new();
    let mut ui = fit_ui(&source);
    dispatch(&mut ui, &source, EqMessage::Select(1));
    dispatch(
        &mut ui,
        &source,
        EqMessage::Knob(knobs::KnobMessage::Edit(Number::Frequency)),
    );
    let key = keyboard::Key::Named(keyboard::key::Named::Backspace);
    dispatch(
        &mut ui,
        &source,
        EqMessage::Key(keyboard::Event::KeyPressed {
            key: key.clone(),
            modified_key: key,
            physical_key: keyboard::key::Physical::Code(keyboard::key::Code::Backspace),
            location: keyboard::Location::Standard,
            modifiers: keyboard::Modifiers::empty(),
            text: None,
            repeat: false,
        }),
    );
    assert_eq!(ui.model.borrow().config.bands.len(), 3);
}

#[test]
fn canceled_graph_or_knob_drag_publishes_correction_even_when_parameter_cache_is_unchanged() {
    use knobs::KnobMessage;
    for rotary in [false, true] {
        let source = Harness::settlement(false);
        let mut ui = fit_ui(&source);
        dispatch(&mut ui, &source, EqMessage::Select(1));
        let original = ui.model.borrow().focused().unwrap().gain_db;
        if rotary {
            dispatch(
                &mut ui,
                &source,
                EqMessage::Knob(KnobMessage::Begin(Number::Gain)),
            );
            dispatch(
                &mut ui,
                &source,
                EqMessage::Knob(KnobMessage::Change(Number::Gain, original + 3.0)),
            );
        } else {
            dispatch(
                &mut ui,
                &source,
                EqMessage::Graph(GraphMessage::BeginDrag {
                    id: 1,
                    additive: false,
                    solo: false,
                }),
            );
            dispatch(
                &mut ui,
                &source,
                EqMessage::Graph(GraphMessage::Drag {
                    frequency_ratio: 1.0,
                    gain_delta: 3.0,
                }),
            );
        }
        let older = ui.expected.borrow().clone();
        dispatch(&mut ui, &source, EqMessage::Cancel);
        let canceled = ui.expected.borrow().clone();
        let gain_id = crate::params::BAND_BASE + 4;
        assert_eq!(
            source
                .events
                .lock()
                .unwrap()
                .iter()
                .filter(|(kind, id)| *kind == 's' && *id == gain_id)
                .count(),
            2,
            "cancellation must send a correction even if authoritative Params still have the initial gain"
        );
        for (id, value) in older {
            source.params.set_normalized(id, value);
        }
        ui.synchronize();
        assert!((ui.model.borrow().focused().unwrap().gain_db - original).abs() < 1e-8);
        assert!(!ui.expected.borrow().is_empty());
        for (id, value) in canceled {
            source.params.set_normalized(id, value);
        }
        ui.synchronize();
        assert!(ui.expected.borrow().is_empty());
        assert!((source.params.get_plain(gain_id).unwrap() - original).abs() < 1e-8);
        assert!(ui.edited.is_empty());
        assert!(!ui.model.borrow().has_gesture());
    }
}

#[test]
fn cut_slope_controls_leave_rbj_bands_unchanged_in_a_mixed_selection() {
    let source = Harness::new();
    let mut ui = fit_ui(&source);
    dispatch(&mut ui, &source, EqMessage::Select(1));
    dispatch(&mut ui, &source, EqMessage::Shape(EqShape::LowCut));
    dispatch(
        &mut ui,
        &source,
        EqMessage::Graph(GraphMessage::SelectArea {
            ids: vec![1, 2],
            additive: false,
        }),
    );
    dispatch(&mut ui, &source, EqMessage::Slope(24.0));
    assert_eq!(ui.model.borrow().config.bands[0].slope_db_oct, 24.0);
    assert_eq!(ui.model.borrow().config.bands[1].slope_db_oct, 12.0);
    dispatch(
        &mut ui,
        &source,
        EqMessage::Draft(Number::Slope, "48".into()),
    );
    dispatch(&mut ui, &source, EqMessage::Submit(Number::Slope));
    assert_eq!(ui.model.borrow().config.bands[0].slope_db_oct, 48.0);
    assert_eq!(ui.model.borrow().config.bands[1].slope_db_oct, 12.0);
}

#[test]
fn pending_parameter_guard_keeps_finished_drag_while_cache_differs_from_latest_intent() {
    let source = Harness::settlement(false);
    let session = source.session();
    let context = source.context();
    let preset = Preset::parse(include_str!("../../tests/fixtures/fit-preset.json")).unwrap();
    for (id, value) in source.params.normalized_values(&preset.config) {
        source.params.set_normalized(id, value);
    }
    let mut ui = EqUi::new(source.params.clone());
    ui.session = Some(session.clone());
    let mut send = |message| {
        session
            .with_permission(|| ui.handle(EqMessage::Graph(message), &context))
            .unwrap();
    };
    send(GraphMessage::BeginDrag {
        id: 1,
        additive: false,
        solo: false,
    });
    send(GraphMessage::Drag {
        frequency_ratio: 2.0,
        gain_delta: 3.0,
    });
    send(GraphMessage::End);
    let first = ui.expected.borrow().clone();
    ui.synchronize();
    assert!((ui.model.borrow().config.bands[0].frequency_hz - 360.0).abs() < 1e-6);
    for message in [
        GraphMessage::BeginDrag {
            id: 1,
            additive: false,
            solo: false,
        },
        GraphMessage::Drag {
            frequency_ratio: 0.5,
            gain_delta: -1.0,
        },
        GraphMessage::End,
    ] {
        session
            .with_permission(|| ui.handle(EqMessage::Graph(message), &context))
            .unwrap();
    }
    let latest = ui.expected.borrow().clone();
    for (id, value) in first {
        source.params.set_normalized(id, value);
    }
    ui.synchronize();
    assert!((ui.model.borrow().config.bands[0].frequency_hz - 180.0).abs() < 1e-6);
    assert!((ui.model.borrow().config.bands[0].gain_db - 5.0).abs() < 1e-6);
    for (id, value) in latest {
        source.params.set_normalized(id, value);
    }
    ui.synchronize();
    assert!(ui.expected.borrow().is_empty());
    assert!((ui.model.borrow().config.bands[0].gain_db - 5.0).abs() < 1e-6);
}

#[test]
fn wrapper_revokes_raw_host_before_asynchronous_close_and_cannot_revive_old_runtime() {
    let mut harness = Harness::new();
    let context = harness.context();
    let session = harness.session();
    context.begin_edit(0u32);
    context.set_param(0u32, 0.6);
    harness.editor.close();
    assert!(
        harness.raw.upgrade().is_none(),
        "queued Iced context must retain only the revoked gate"
    );
    assert_eq!(
        *harness.events.lock().unwrap(),
        vec![('b', 0), ('s', 0), ('e', 0)]
    );
    context.set_param(0u32, 1.0);
    context.begin_edit(1u32);
    context.end_edit(1u32);
    assert!(!context.request_resize(1200, 800));
    assert!(session::matching(&context).is_none());
    assert!(
        session
            .with_permission(|| panic!("closed source accepted a message"))
            .is_none()
    );
    let new_host = host(harness.params.clone(), harness.events.clone());
    let erased: Arc<dyn Params> = harness.params.clone();
    harness.editor.open(
        RawWindowHandle::Win32(std::ptr::null_mut()),
        PluginContext::new(new_host, erased),
    );
    assert!(session::matching(&context).is_none());
    assert!(harness.session().is_open());
    assert_eq!(harness.events.lock().unwrap().len(), 3);
}

#[test]
fn freezing_preserves_local_raw_and_display_sidechain_until_unfreeze() {
    let source = Harness::new();
    let mut analyzer = source.params.telemetry.analyzer_config();
    analyzer.tilt_db_oct = 6.0;
    analyzer.channel = EqChannel::Side;
    source.params.telemetry.set_analyzer(analyzer).unwrap();
    for index in 0..8192 {
        let sample = (std::f32::consts::TAU * 4000.0 * index as f32 / 44100.0).sin() * 0.1;
        source.params.telemetry.capture(
            [sample, -sample],
            [sample * 0.5, -sample * 0.5],
            [sample * 0.8, -sample * 0.8],
        );
    }
    let (expected_raw, expected_display) = source.params.telemetry.spectrum_pair();
    let mut ui = EqUi::new(source.params.clone());
    ui.session = Some(source.session());
    dispatch(&mut ui, &source, EqMessage::Freeze);
    let raw = ui.frozen.as_ref().unwrap();
    let display = ui.frozen_display.as_ref().unwrap();
    assert_eq!(raw.sequence, expected_raw.sequence);
    assert_eq!(raw.pre_db, expected_raw.pre_db);
    assert_eq!(raw.post_db, expected_raw.post_db);
    assert_eq!(raw.external_db, expected_raw.external_db);
    assert_eq!(display.sequence, expected_display.sequence);
    assert_eq!(display.pre_db, expected_display.pre_db);
    assert_eq!(display.post_db, expected_display.post_db);
    assert_eq!(display.external_db, expected_display.external_db);
    assert_ne!(
        display.pre_db, raw.pre_db,
        "display tilt must not enter raw matching"
    );
    let frozen_sequence = raw.sequence;
    for _ in 0..8192 {
        source
            .params
            .telemetry
            .capture([0.0; 2], [0.0; 2], [0.0; 2]);
    }
    assert_eq!(ui.frozen.as_ref().unwrap().sequence, frozen_sequence);
    assert_eq!(
        ui.frozen_display.as_ref().unwrap().external_db,
        expected_display.external_db
    );
    dispatch(&mut ui, &source, EqMessage::Freeze);
    assert!(ui.frozen.is_none() && ui.frozen_display.is_none());
}

#[test]
fn editing_and_audition_apply_only_to_this_editors_parameters() {
    let source = Harness::new();
    let other = Harness::new();
    let mut ui = fit_ui(&source);
    dispatch(&mut ui, &source, EqMessage::GainScale(0.5));
    dispatch(&mut ui, &source, EqMessage::EndControl);
    assert!((source.params.get_plain(3).unwrap() - 0.5).abs() < 1.0e-8);
    assert!((other.params.get_plain(3).unwrap() - 1.0).abs() < 1.0e-8);
    assert!(other.events.lock().unwrap().is_empty());
    dispatch(&mut ui, &source, EqMessage::Select(1));
    dispatch(&mut ui, &source, EqMessage::Solo);
    assert_eq!(source.params.telemetry.solo(), Some(1));
    assert_eq!(other.params.telemetry.solo(), None);
}
