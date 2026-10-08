//! Host recalls supersede editor gestures, including delayed pointer messages.

use super::*;

impl EqUi {
    pub(super) fn observe_state_restore(&self) {
        let revision = self.params.telemetry.state_restore_revision();
        if revision == self.last_restore_revision.get() {
            return;
        }
        // End discards the initial drag snapshot. Cancel would incorrectly put
        // pre-recall values back into the model and subsequently into the host.
        let mut model = self.model.borrow_mut();
        model.end();
        model.solo = None;
        self.expected.borrow_mut().clear();
        model.synchronize(self.params.snapshot());
        model.synchronize_extras(read_extras(&self.params));
        self.last_restore_revision.set(revision);
    }

    pub(super) fn handle_state_restore(&mut self, context: &PluginContext<EqParams>) {
        let revision = self.params.telemetry.state_restore_revision();
        if revision == self.handled_restore_revision {
            return;
        }
        self.observe_state_restore();
        // The wrapper already ended the gate's edits synchronously. These ends
        // clear local bookkeeping; the gate suppresses duplicate host callbacks.
        self.close_edits(context);
        self.transient_solo = false;
        self.drafts.clear();
        self.dismiss_panels();
        self.handled_restore_revision = revision;
    }

    pub(super) fn panel_for_view(&self) -> Option<Panel> {
        (self.handled_restore_revision == self.params.telemetry.state_restore_revision())
            .then_some(self.panel)
            .flatten()
    }

    pub(super) fn numeric_for_view(&self) -> Option<Number> {
        (self.handled_restore_revision == self.params.telemetry.state_restore_revision())
            .then_some(self.numeric_edit)
            .flatten()
    }

    pub(super) fn draft_for_view(&self, field: Number) -> Option<&String> {
        (self.handled_restore_revision == self.params.telemetry.state_restore_revision())
            .then(|| self.drafts.get(&field))
            .flatten()
    }
}
