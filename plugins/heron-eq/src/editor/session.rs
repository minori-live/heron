//! Revocable host callbacks and audition ownership for this editor only.

use crate::params::EqParams;
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex, OnceLock, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use truce::core::{
    editor::{EditorBridge, PluginContext},
    events::TransportInfo,
};
use truce::prelude::Params;

static SESSIONS: OnceLock<Mutex<Vec<Weak<Session>>>> = OnceLock::new();
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

fn next_generation() -> u64 {
    let mut generation = NEXT_SESSION.load(Ordering::Relaxed);
    loop {
        let next = if generation == (u64::MAX >> 5) {
            1
        } else {
            generation + 1
        };
        match NEXT_SESSION.compare_exchange_weak(
            generation,
            next,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => return generation,
            Err(current) => generation = current,
        }
    }
}

struct Host {
    bridge: Arc<dyn EditorBridge>,
    edits: BTreeMap<u32, usize>,
}

/// The raw host bridge never escapes this lock. Revocation waits for callbacks
/// already in progress, including calls made by the upstream Iced runtime.
pub struct GateBridge {
    host: Mutex<Option<Host>>,
    params: Arc<EqParams>,
}

impl GateBridge {
    fn call<T>(&self, action: impl FnOnce(&mut Host) -> T) -> Option<T> {
        self.host
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_mut()
            .map(action)
    }
    fn close(&self) {
        let mut host = self.host.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(host) = host.take() {
            for (id, _) in host.edits {
                host.bridge.end_edit(id);
            }
        }
    }
    fn end_edits(&self) {
        self.call(|host| {
            for (id, _) in std::mem::take(&mut host.edits) {
                host.bridge.end_edit(id);
            }
        });
    }
    fn is_open(&self) -> bool {
        self.host
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .is_some()
    }
}

impl EditorBridge for GateBridge {
    fn begin_edit(&self, id: u32) {
        self.call(|host| {
            let count = host.edits.entry(id).or_default();
            if *count == 0 {
                host.bridge.begin_edit(id);
            }
            *count += 1;
        });
    }
    fn set_param(&self, id: u32, value: f64) {
        self.call(|host| host.bridge.set_param(id, value));
    }
    fn end_edit(&self, id: u32) {
        self.call(|host| {
            if let Some(count) = host.edits.get_mut(&id) {
                *count -= 1;
                if *count == 0 {
                    host.edits.remove(&id);
                    host.bridge.end_edit(id);
                }
            }
        });
    }
    fn request_resize(&self, w: u32, h: u32) -> bool {
        self.call(|host| host.bridge.request_resize(w, h))
            .unwrap_or(false)
    }
    fn get_param(&self, id: u32) -> f64 {
        self.params.get_normalized(id).unwrap_or(0.0)
    }
    fn get_param_plain(&self, id: u32) -> f64 {
        self.params.get_plain(id).unwrap_or(0.0)
    }
    fn format_param(&self, id: u32) -> String {
        self.call(|host| host.bridge.format_param(id))
            .unwrap_or_default()
    }
    fn get_meter(&self, id: u32) -> f32 {
        self.call(|host| host.bridge.get_meter(id)).unwrap_or(0.0)
    }
    fn get_state(&self) -> Vec<u8> {
        self.call(|host| host.bridge.get_state())
            .unwrap_or_default()
    }
    fn set_state(&self, data: Vec<u8>) {
        self.call(|host| host.bridge.set_state(data));
    }
    fn transport(&self) -> Option<TransportInfo> {
        self.call(|host| host.bridge.transport()).flatten()
    }
}

pub struct Session {
    params: Weak<EqParams>,
    gate: Arc<GateBridge>,
    context: PluginContext<EqParams>,
    permission: Mutex<bool>,
    generation: u64,
    live: AtomicBool,
    solo: Mutex<()>,
}

impl Session {
    pub fn state_restored(&self) {
        self.with_permission(|| {
            self.gate.end_edits();
            self.release_solo();
            if let Some(params) = self.params.upgrade() {
                params.telemetry.state_restored();
            }
        });
    }
    /// Serialize local audition with revocation, including delayed UI teardown.
    pub fn publish_solo(&self, band_id: Option<u32>) {
        let _solo = self.solo.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(params) = self.params.upgrade() {
            params.telemetry.clear_solo_owned(self.generation);
            if self.live.load(Ordering::Acquire)
                && let Some(band_id) = band_id.filter(|id| (1..=24).contains(id))
            {
                params.telemetry.set_solo_owned(self.generation, band_id);
            }
        }
    }
    pub fn release_solo(&self) {
        let _solo = self.solo.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(params) = self.params.upgrade() {
            params.telemetry.clear_solo_owned(self.generation);
        }
    }
    pub fn with_permission<T>(&self, action: impl FnOnce() -> T) -> Option<T> {
        let permission = self
            .permission
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        (*permission).then(action)
    }
    pub fn close(&self) {
        {
            let mut permission = self
                .permission
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            *permission = false;
            self.live.store(false, Ordering::Release);
        }
        self.release_solo();
        self.gate.close();
    }
    pub fn is_open(&self) -> bool {
        self.gate.is_open()
    }
    pub fn context(&self) -> &PluginContext<EqParams> {
        &self.context
    }
    fn matches(&self, context: &PluginContext<EqParams>) -> bool {
        Arc::ptr_eq(self.context.bridge(), context.bridge())
    }
}

pub fn register(params: &Arc<EqParams>, context: &PluginContext) -> Arc<Session> {
    let gate = Arc::new(GateBridge {
        host: Mutex::new(Some(Host {
            bridge: context.bridge().clone(),
            edits: BTreeMap::new(),
        })),
        params: params.clone(),
    });
    let session = Arc::new(Session {
        params: Arc::downgrade(params),
        context: PluginContext::new(gate.clone(), params.clone()),
        gate,
        permission: Mutex::new(true),
        generation: next_generation(),
        live: AtomicBool::new(true),
        solo: Mutex::new(()),
    });
    let mut sessions = SESSIONS
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    sessions.retain(|session| session.strong_count() > 0);
    sessions.push(Arc::downgrade(&session));
    session
}

/// Match only the exact bridge passed to this Iced runtime. Sessions cannot be
/// enumerated or selected by another plug-in's identifier.
pub fn matching(context: &PluginContext<EqParams>) -> Option<Arc<Session>> {
    SESSIONS
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .iter()
        .filter_map(Weak::upgrade)
        .find(|session| session.matches(context) && session.is_open())
}
