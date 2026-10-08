//! Synchronously revoke host callbacks before Iced's asynchronous window close.

use super::session::{self, Session};
use crate::params::EqParams;
use std::sync::Arc;
use truce::{
    core::editor::{Editor, PluginContext, RawWindowHandle},
    prelude::Params,
};

pub struct HeronEqEditor {
    params: Arc<EqParams>,
    inner: Box<dyn Editor>,
    session: Option<Arc<Session>>,
}

impl HeronEqEditor {
    pub fn new(params: Arc<EqParams>, inner: Box<dyn Editor>) -> Self {
        Self {
            params,
            inner,
            session: None,
        }
    }
    fn revoke(&mut self) {
        if let Some(session) = self.session.take() {
            session.close();
        }
    }
}

impl Editor for HeronEqEditor {
    fn size(&self) -> (u32, u32) {
        self.inner.size()
    }
    fn open(&mut self, parent: RawWindowHandle, context: PluginContext) {
        self.revoke();
        let session = session::register(&self.params, &context);
        let gated = session.context().with_params(context.params().clone());
        self.session = Some(session);
        self.inner.open(parent, gated);
    }
    fn close(&mut self) {
        self.revoke();
        self.inner.close();
    }
    fn idle(&mut self) {
        self.inner.idle();
    }
    fn set_size(&mut self, w: u32, h: u32) -> bool {
        self.inner.set_size(w, h)
    }
    fn can_resize(&self) -> bool {
        self.inner.can_resize()
    }
    fn can_maximize(&self) -> bool {
        self.inner.can_maximize()
    }
    fn min_size(&self) -> (u32, u32) {
        self.inner.min_size()
    }
    fn max_size(&self) -> (u32, u32) {
        self.inner.max_size()
    }
    fn size_increment(&self) -> Option<(u32, u32)> {
        self.inner.size_increment()
    }
    fn aspect_ratio(&self) -> Option<(u32, u32)> {
        self.inner.aspect_ratio()
    }
    fn prefers_pow2(&self) -> bool {
        self.inner.prefers_pow2()
    }
    fn set_scale_factor(&mut self, factor: f64) {
        self.inner.set_scale_factor(factor);
    }
    fn set_uses_system_scale(&mut self, yes: bool) {
        self.inner.set_uses_system_scale(yes);
    }
    fn state_changed(&mut self) {
        // IcedEditor does not forward this Editor callback to IcedPlugin. Wake
        // the live UI through shared state and revoke its old gesture first.
        if let Some(session) = &self.session {
            session.state_restored();
        } else {
            self.params.telemetry.state_restored();
        }
        self.inner.state_changed();
    }
    fn screenshot(&mut self, params: Arc<dyn Params>) -> Option<(Vec<u8>, u32, u32)> {
        self.inner.screenshot(params)
    }
}
impl Drop for HeronEqEditor {
    fn drop(&mut self) {
        self.revoke();
        self.inner.close();
    }
}
