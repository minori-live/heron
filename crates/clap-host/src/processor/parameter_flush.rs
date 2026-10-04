use std::sync::{Arc, atomic::Ordering};

use clap_sys::{
    events::{clap_input_events, clap_output_events},
    ext::params::{CLAP_EXT_PARAMS, clap_plugin_params},
};

use super::{
    ClapProcessorHandle, InputEventBuffer, input_event_count, input_event_get, push_output_event,
};

impl ClapProcessorHandle {
    #[must_use]
    pub fn has_pending_parameters(&self) -> bool {
        self.parameters.head.load(Ordering::Acquire) != self.parameters.tail.load(Ordering::Acquire)
    }

    /// Apply candidate values on its owning main thread before any graph can process it.
    /// The caller deactivates the sole unpublished endpoint and reactivates it afterward.
    pub fn flush_parameters_while_inactive(&mut self) -> Result<(), &'static str> {
        if self.leases.load(Ordering::Acquire) != 1 || self.lifecycle.load(Ordering::Acquire) != 0 {
            return Err("CLAP parameter preparation requires an exclusive inactive processor");
        }
        if !self.has_pending_parameters() {
            return Ok(());
        }
        // SAFETY: This sole endpoint retains the plug-in and is held by its main-thread owner.
        let plugin = unsafe { self.plugin.0.as_ref() };
        let get_extension = plugin
            .get_extension
            .ok_or("CLAP get_extension is unavailable")?;
        // SAFETY: The instance is initialized and the extension ID is a static CLAP string.
        let extension = unsafe {
            get_extension(self.plugin.0.as_ptr(), CLAP_EXT_PARAMS.as_ptr())
                .cast::<clap_plugin_params>()
                .as_ref()
        }
        .ok_or("CLAP parameter extension is unavailable")?;
        let flush = extension
            .flush
            .ok_or("CLAP parameter flush is unavailable")?;
        self.drain_parameters();
        let input = clap_input_events {
            ctx: (&mut self.events as *mut InputEventBuffer).cast(),
            size: Some(input_event_count),
            get: Some(input_event_get),
        };
        let output = clap_output_events {
            ctx: Arc::as_ptr(&self.output_parameters).cast_mut().cast(),
            try_push: Some(push_output_event),
        };
        // SAFETY: CLAP permits inactive parameter flush on the owning main thread. A sole
        // processor lease and the inactive lifecycle exclude concurrent process/flush calls.
        // The preallocated input/output event interfaces remain valid for this call.
        unsafe { flush(self.plugin.0.as_ptr(), &input, &output) };
        self.events.events.clear();
        self.events.sysex.clear();
        Ok(())
    }
}
