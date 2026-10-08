//! Transient panels and continuous control lifetimes, owned by the editor.
use super::{EqUi, Panel, knobs::KnobMessage, model::Number};

pub(super) fn handles_key(event: &super::keyboard::Event) -> bool {
    use super::keyboard::{Event, Key, key::Named};
    match event {
        Event::KeyPressed {
            key: Key::Named(Named::Escape | Named::Delete | Named::Backspace),
            ..
        } => true,
        Event::KeyPressed {
            key: Key::Character(value),
            modifiers,
            ..
        } if modifiers.command() || modifiers.control() => {
            matches!(value.to_lowercase().as_str(), "d" | "c" | "v")
        }
        _ => false,
    }
}

impl EqUi {
    pub(super) fn dismiss_panels(&mut self) {
        self.panel = None;
        self.context_menu = None;
        self.numeric_edit = None;
    }

    pub(super) fn toggle_panel(&mut self, panel: Panel) {
        self.notice = None;
        let next = (self.panel != Some(panel)).then_some(panel);
        self.dismiss_panels();
        self.panel = next;
    }

    pub(super) fn cancel_gesture(&mut self) {
        self.notice = None;
        self.model.get_mut().cancel();
        self.model.get_mut().solo = None;
        self.publish_solo(None);
        self.transient_solo = false;
        self.drafts.clear();
        self.dismiss_panels();
    }

    pub(super) fn knob(&mut self, message: KnobMessage) -> bool {
        match message {
            KnobMessage::Begin(_) => {
                self.numeric_edit = None;
                self.model.get_mut().begin();
                self.drafts.clear();
                self.model.get_mut().has_gesture()
            }
            KnobMessage::Change(field, value) => {
                self.model.get_mut().knob(field, value);
                let maximum = (self.active_params().telemetry.sample_rate() * 0.499).min(30_000.0);
                for band in &mut self.model.get_mut().config.bands {
                    band.frequency_hz = band.frequency_hz.min(maximum);
                }
                self.model.get_mut().has_gesture()
            }
            KnobMessage::End => {
                self.model.get_mut().end();
                false
            }
            KnobMessage::Cancel => {
                self.cancel_gesture();
                false
            }
            KnobMessage::Edit(field) => {
                self.dismiss_panels();
                self.numeric_edit = Some(field);
                self.drafts.clear();
                false
            }
            KnobMessage::Step(field, value) => {
                self.step_knob(field, value);
                false
            }
            KnobMessage::Reset(field) => {
                let value = match field {
                    Number::Frequency => 1000.0,
                    Number::Q => 1.0,
                    _ => 0.0,
                };
                self.step_knob(field, value);
                false
            }
        }
    }

    pub(super) fn step_knob(&mut self, field: Number, value: f64) {
        self.model.get_mut().begin();
        self.change(|model| model.knob(field, value));
        self.model.get_mut().end();
    }
}
