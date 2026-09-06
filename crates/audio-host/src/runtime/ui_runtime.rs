use self::embedded_editors::EmbeddedEditorHost;
use super::{
    ActorCommand, ActorRequest, Arc, AtomicU64, ControlCommand, ControlResult, Duration, HashMap,
    HostEvent, Instant, LiveMixerGraph, Mutex, Ordering, PluginFailureCategory,
    PluginFailureOutcome, PluginFailureStage, PluginProcessFailure, PluginRuntimeFailure, VecDeque,
    Vst3HostRequest, clap, engine, mpsc, queue_background_graph_build, std_mpsc, vst3,
};

#[derive(Debug, Clone)]
pub struct EmbeddedEditorHostRegistration {
    pub instance_id: String,
    pub parent_window: usize,
    pub width: u32,
    pub height: u32,
    pub top_inset: u32,
    pub display_scale: f64,
}

#[derive(Debug, Clone)]
pub struct EmbeddedEditorHostSnapshot {
    pub instance_id: String,
    pub width: u32,
    pub height: u32,
    pub display_scale: f64,
    pub resizable: bool,
    pub attached: bool,
}

#[derive(Debug, Clone)]
pub struct EmbeddedEditorHostEvent {
    pub instance_id: String,
    pub width: u32,
    pub height: u32,
    pub resizable: bool,
}

pub(super) enum UiEvent {
    Wake,
    Exit,
}

#[derive(Clone)]
pub(super) struct UiMailboxWaker {
    wake: Arc<Mutex<Option<UiWakeCallback>>>,
}

type UiWakeCallback = Arc<dyn Fn() + Send + Sync + 'static>;

impl UiMailboxWaker {
    pub(super) fn new(wake: UiWakeCallback) -> Self {
        Self {
            wake: Arc::new(Mutex::new(Some(wake))),
        }
    }

    pub(super) fn send_event(&self, _event: UiEvent) {
        let wake = self.wake.lock().ok().and_then(|wake| wake.clone());
        if let Some(wake) = wake {
            wake();
        }
    }

    pub(super) fn disable(&self) {
        if let Ok(mut wake) = self.wake.lock() {
            wake.take();
        }
    }
}

pub(super) struct EmbeddedUiHost {
    pub(super) generation: Arc<AtomicU64>,
    pub(super) proxy: UiMailboxWaker,
    pub(super) inbox: std_mpsc::Receiver<ActorRequest>,
    pub(super) processors: Arc<Mutex<HashMap<String, vst3::AudioPluginProcessorHandle>>>,
    pub(super) audio_engine: Arc<engine::AudioEngine>,
    pub(super) background_sender: mpsc::Sender<ActorRequest>,
    pub(super) host_events: std_mpsc::SyncSender<HostEvent>,
    pub(super) pending_ara_events: VecDeque<HostEvent>,
    pub(super) vst3: Option<vst3::Vst3Runtime>,
    pub(super) clap: Option<clap::ClapRuntime>,
    pub(super) ara_graph: Option<LiveMixerGraph>,
    pub(super) next_ara_tick: Option<Instant>,
    pub(super) next_retirement_tick: Option<Instant>,
    pub(super) next_sidechain_request_id: u64,
    pub(super) embedded_editor_hosts: HashMap<String, EmbeddedEditorHost>,
    pub(super) embedded_editor_events:
        std::rc::Rc<std::cell::RefCell<VecDeque<EmbeddedEditorHostEvent>>>,
    pub(super) embedded_editor_clipboard: Option<(String, embedded_editors::EditorPluginState)>,
}

impl EmbeddedUiHost {
    // VST3 controller calls must stay on this thread, but the same thread also
    // owns every native editor window. Bound each mailbox turn so plug-in code
    // cannot indefinitely delay the next platform-message dispatch.
    pub(super) const UI_BATCH: usize = 4;
    pub(super) const UI_BUDGET: std::time::Duration = std::time::Duration::from_millis(2);
    pub(super) const ARA_CALLBACK_TICK: Duration = Duration::from_millis(33);
    pub(super) const RETIREMENT_TICK: Duration = Duration::from_millis(16);

    pub(in crate::runtime) fn disable_ui_wake(&self) {
        self.proxy.disable();
    }
}

#[cfg(test)]
pub(super) mod test_support {
    use super::*;
    use heron_audio_plugin::{
        AudioPluginProcessor, AudioPluginProcessorHandle, AudioPortToken, ProcessContext,
        SidechainSource,
    };

    #[derive(Clone, Copy)]
    pub(super) enum FixtureFailure {
        Rejected,
        InvalidOutput,
    }

    #[derive(Clone)]
    struct FixtureProcessor {
        failure: Option<FixtureFailure>,
    }

    impl AudioPluginProcessor for FixtureProcessor {
        fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
            Box::new(self.clone())
        }

        fn process_block(
            &mut self,
            frames: &mut [[f32; 2]],
            _sidechains: &dyn SidechainSource,
            _context: &ProcessContext,
        ) -> bool {
            match self.failure {
                Some(FixtureFailure::Rejected) => false,
                Some(FixtureFailure::InvalidOutput) => {
                    frames[0][0] = f32::NAN;
                    true
                }
                None => true,
            }
        }
    }

    struct NoSidechains;

    impl SidechainSource for NoSidechains {
        fn frames(&self, _port: AudioPortToken) -> Option<&[[f32; 2]]> {
            None
        }
    }

    fn process_context() -> ProcessContext {
        ProcessContext {
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
        }
    }

    pub(super) fn processor(failure: Option<FixtureFailure>) -> AudioPluginProcessorHandle {
        let handle = AudioPluginProcessorHandle::new(FixtureProcessor { failure });
        if failure.is_some() {
            let mut callback_handle = handle.clone();
            callback_handle.set_failure_context(7, 11);
            let mut frames = [[0.25, 0.5]];
            assert!(!callback_handle.process_block(&mut frames, &NoSidechains, &process_context()));
        }
        handle
    }

    pub(super) fn host(event_capacity: usize) -> (EmbeddedUiHost, std_mpsc::Receiver<HostEvent>) {
        let (_inbox_sender, inbox) = std_mpsc::sync_channel(1);
        let (background_sender, _background_inbox) = mpsc::channel(1);
        let (host_events, host_event_inbox) = std_mpsc::sync_channel(event_capacity);
        (
            EmbeddedUiHost {
                generation: Arc::new(AtomicU64::new(0)),
                proxy: UiMailboxWaker::new(Arc::new(|| {})),
                inbox,
                processors: Arc::new(Mutex::new(HashMap::new())),
                audio_engine: Arc::new(engine::AudioEngine::new()),
                background_sender,
                host_events,
                pending_ara_events: VecDeque::new(),
                vst3: None,
                clap: None,
                ara_graph: None,
                next_ara_tick: None,
                next_retirement_tick: None,
                next_sidechain_request_id: 1,
                embedded_editor_hosts: HashMap::new(),
                embedded_editor_events: std::rc::Rc::new(std::cell::RefCell::new(VecDeque::new())),
                embedded_editor_clipboard: None,
            },
            host_event_inbox,
        )
    }
}

#[path = "ui_runtime/ara_events.rs"]
mod ara_events;
#[path = "ui_runtime/editor_commands.rs"]
mod editor_commands;
#[path = "ui_runtime/embedded_editors.rs"]
mod embedded_editors;
#[path = "ui_runtime/event_loop.rs"]
mod event_loop;
#[path = "ui_runtime/window_config.rs"]
mod window_config;

pub(super) use window_config::{should_drain_ui_request, vst3_host_request_payload};

#[cfg(test)]
#[path = "ui_runtime/graph_deployment_tests.rs"]
mod graph_deployment_tests;
