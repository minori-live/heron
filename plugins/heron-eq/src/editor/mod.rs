//! Native visual editor for Heron EQ.

mod band_clipboard;
mod band_controls;
mod choices;
mod chrome;
mod controls;
mod geometry;
mod graph;
mod icons;
mod knobs;
mod matching;
mod meters;
mod model;
mod node_labels;
mod notice;
mod overlays;
mod popovers;
mod preset;
mod response_preview;
#[cfg(test)]
mod screenshot;
mod session;
mod spectrum_plot;
mod state_restore;
mod style;
#[cfg(test)]
mod tests;
mod update;
mod update_ui;
mod view;
mod wrapper;

use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use crate::analyzer::{AnalyzerResolution, AnalyzerSpeed};
use heron_dsp_core::eq::{EqChannel, EqShape, LinearPhaseResolution, ProcessingMode};
use truce::{
    core::editor::PluginContext,
    prelude::{Editor, IntoEditor, Params},
};
use truce_iced::{
    IcedEditor, IcedPlugin, Message, ParamCache,
    iced::{
        Element, Event, Length, Subscription, Task, event, keyboard,
        widget::{Canvas, Column, container},
    },
};

use crate::{params::EqParams, telemetry::SpectrumSnapshot};
use graph::{Graph, GraphMessage};
use model::{Extras, Model, Number};
use preset::Preset;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Panel {
    Processing,
    Analyzer,
    Output,
    Tools,
    BandActions,
    Midi,
}

#[derive(Debug, Clone)]
pub enum EqMessage {
    Menu(Panel),
    DismissPanels,
    DismissNotice,
    Knob(knobs::KnobMessage),
    KnobAt(u64, knobs::KnobMessage),
    Graph(GraphMessage),
    GraphAt(u64, GraphMessage),
    Draft(Number, String),
    Submit(Number),
    Select(u32),
    Shape(EqShape),
    Slope(f64),
    Channel(EqChannel),
    Mode(ProcessingMode),
    Resolution(LinearPhaseResolution),
    Learn(Number),
    LearnParam(u32),
    ForgetMidi,
    ForgetGlobalMidi,
    BandEnabled(bool),
    Delete,
    Duplicate,
    CopyBands,
    PasteBands,
    Solo,
    Cancel,
    Pre,
    Post,
    External,
    Freeze,
    Piano,
    Range(u8),
    ViewChannel(EqChannel),
    Match,
    Analyzer,
    AnalyzerResolution(AnalyzerResolution),
    AnalyzerSpeed(AnalyzerSpeed),
    AnalyzerTilt(f32),
    SpectrumFloor(u16),
    Collision,
    SplitChannels(EqChannel, EqChannel),
    GainScale(f64),
    PhaseInvert(bool),
    AutoGain(bool),
    PanMode(u8),
    Pan(f64),
    OutputMute(bool),
    Bypass,
    EndControl,
    Key(keyboard::Event),
}

pub struct EqUi {
    params: Arc<EqParams>,
    model: RefCell<Model>,
    drafts: BTreeMap<Number, String>,
    edited: BTreeSet<u32>,
    expected: RefCell<Vec<(u32, f64)>>,
    pre: bool,
    post: bool,
    external: bool,
    frozen: Option<SpectrumSnapshot>,
    frozen_display: Option<SpectrumSnapshot>,
    piano: bool,
    range: u8,
    channel: EqChannel,
    session: Option<Arc<session::Session>>,
    panel: Option<Panel>,
    context_menu: Option<truce_iced::iced::Point>,
    numeric_edit: Option<Number>,
    notice: Option<notice::Notice>,
    last_sequence: Cell<u64>,
    response_preview: RefCell<response_preview::ResponsePreview>,
    last_preview_revision: Cell<u64>,
    last_restore_revision: Cell<u64>,
    handled_restore_revision: u64,
    transient_solo: bool,
    floor: u16,
    collision: bool,
}

pub fn create(params: Arc<EqParams>) -> Box<dyn Editor> {
    let inner = IcedEditor::<EqParams, EqUi>::new(params.clone(), (1120, 760))
        .resizable(true)
        .min_size((1040, 700))
        .maximizable(true)
        .into_editor();
    wrapper::HeronEqEditor::new(params, inner).into_editor()
}

impl EqUi {
    pub(super) fn publish_solo(&self, band_id: Option<u32>) {
        if let Some(session) = &self.session {
            session.publish_solo(band_id);
        }
    }

    fn active_params(&self) -> Arc<EqParams> {
        self.params.clone()
    }

    fn ensure_session(&mut self, context: &PluginContext<EqParams>) {
        if self.session.is_none() {
            self.session = session::matching(context);
        }
    }

    fn synchronize(&mut self) {
        let params = self.active_params();
        if !self
            .expected
            .get_mut()
            .iter()
            .all(|(id, value)| (params.get_normalized(*id).unwrap_or(0.0) - value).abs() < 1.0e-9)
        {
            return;
        }
        self.expected.get_mut().clear();
        let config = params.snapshot();
        let extras = read_extras(&params);
        let model = self.model.get_mut();
        model.synchronize(config);
        model.synchronize_extras(extras);
    }

    fn change(&mut self, action: impl FnOnce(&mut Model)) {
        self.change_result(action);
    }

    fn change_result(&mut self, action: impl FnOnce(&mut Model)) -> bool {
        let sample_rate = self.active_params().telemetry.sample_rate();
        let maximum = (sample_rate * 0.499).min(30_000.0);
        let mut clamped = false;
        let result = self.model.get_mut().change_checked(
            |model| {
                action(model);
                for band in &mut model.config.bands {
                    if band.frequency_hz > maximum {
                        band.frequency_hz = maximum;
                        clamped = true;
                    }
                }
            },
            sample_rate,
        );
        if result.is_err() {
            self.notify(
                "These settings are unavailable for this shape, processing mode or sample rate.",
                true,
            );
        } else if clamped {
            self.notify(
                format!("Frequency limited to {maximum:.0} Hz at {sample_rate:.0} Hz sample rate."),
                false,
            );
        }
        self.drafts.clear();
        result.is_ok()
    }

    fn apply(&mut self, context: &PluginContext<EqParams>, keep_open: bool) {
        if self
            .session
            .as_ref()
            .is_some_and(|session| session.is_open())
        {
            self.apply_target(context, keep_open);
        }
    }

    fn apply_target(&mut self, context: &PluginContext<EqParams>, keep_open: bool) {
        let params = self.active_params();
        let _transaction = params.telemetry.begin_parameter_edit();
        let pending = self.expected.borrow().clone();
        let model = self.model.get_mut();
        let mut values = params.normalized_values(&model.config);
        values.extend([
            (3, model.extras.gain_scale / 2.0),
            (4, f64::from(model.extras.phase_invert)),
            (5, f64::from(model.extras.auto_gain)),
            (8, (model.extras.output_pan + 1.0) / 2.0),
            (9, f64::from(model.extras.output_pan_mode)),
            (10, f64::from(model.extras.output_mute)),
        ]);
        let needs_write = |id: u32, value: f64| {
            (params.get_normalized(id).unwrap_or(0.0) - value).abs() >= 1.0e-10
                || pending.iter().any(|(previous_id, previous)| {
                    *previous_id == id && (previous - value).abs() >= 1.0e-10
                })
        };
        if values.iter().any(|(id, value)| needs_write(*id, *value)) {
            self.expected.replace(values.clone());
        }
        for (id, value) in values {
            if !needs_write(id, value) {
                continue;
            }
            if self.edited.insert(id) {
                context.begin_edit(id);
            }
            context.set_param(id, value);
            if !keep_open {
                context.end_edit(id);
                self.edited.remove(&id);
            }
        }
        if !keep_open {
            self.close_edits(context);
        }
    }

    fn close_edits(&mut self, context: &PluginContext<EqParams>) {
        for id in std::mem::take(&mut self.edited) {
            context.end_edit(id);
        }
    }

    fn notify(&mut self, text: impl Into<String>, error: bool) {
        self.notice = Some(notice::Notice {
            text: text.into(),
            error,
        });
    }
}

impl IcedPlugin<EqParams> for EqUi {
    type Message = EqMessage;

    fn new(params: Arc<EqParams>) -> Self {
        let restore_revision = params.telemetry.state_restore_revision();
        let mut model = Model::new(params.snapshot());
        model.extras = read_extras(&params);
        model.selected.clear();
        Self {
            params,
            model: RefCell::new(model),
            drafts: BTreeMap::new(),
            edited: BTreeSet::new(),
            expected: RefCell::new(Vec::new()),
            pre: true,
            post: true,
            external: false,
            frozen: None,
            frozen_display: None,
            piano: false,
            range: 12,
            channel: EqChannel::Stereo,
            session: None,
            panel: None,
            context_menu: None,
            numeric_edit: None,
            notice: None,
            last_sequence: Cell::new(0),
            response_preview: RefCell::new(response_preview::ResponsePreview::default()),
            last_preview_revision: Cell::new(0),
            last_restore_revision: Cell::new(restore_revision),
            handled_restore_revision: restore_revision,
            transient_solo: false,
            floor: 120,
            collision: false,
        }
    }

    fn update(
        &mut self,
        message: Message<EqMessage>,
        _params: &ParamCache<EqParams>,
        context: &PluginContext<EqParams>,
    ) -> Task<Message<EqMessage>> {
        self.ensure_session(context);
        let focus = match &message {
            Message::Plugin(EqMessage::Knob(knobs::KnobMessage::Edit(field))) => Some(*field),
            Message::Plugin(EqMessage::KnobAt(_, knobs::KnobMessage::Edit(field))) => Some(*field),
            _ => None,
        };
        if let (Some(session), Message::Plugin(message)) = (self.session.clone(), message) {
            session.with_permission(|| self.handle(message, context));
        }
        if let Some(field) = focus.filter(|field| self.numeric_edit == Some(*field)) {
            return truce_iced::iced::widget::operation::focus(knobs::input_id(field)).chain(
                truce_iced::iced::widget::operation::select_all(knobs::input_id(field)),
            );
        }
        Task::none()
    }

    fn subscription(&self) -> Subscription<Message<EqMessage>> {
        event::listen_with(|event, status, _| match event {
            Event::Keyboard(event) if status == event::Status::Ignored => {
                update_ui::handles_key(&event).then_some(Message::Plugin(EqMessage::Key(event)))
            }
            Event::Window(truce_iced::iced::window::Event::Unfocused) => {
                Some(Message::Plugin(EqMessage::Cancel))
            }
            _ => None,
        })
    }

    fn view<'a>(&'a self, params: &'a ParamCache<EqParams>) -> Element<'a, Message<EqMessage>> {
        self.view_editor(params)
    }

    fn needs_redraw(&self) -> bool {
        self.params.telemetry.sequence() != self.last_sequence.get()
            || self.response_preview.borrow().revision() != self.last_preview_revision.get()
            || self.params.telemetry.state_restore_revision() != self.last_restore_revision.get()
    }
    fn title(&self) -> String {
        "Heron EQ".to_owned()
    }
    fn theme(&self) -> truce_iced::iced::Theme {
        style::theme()
    }
}

impl Drop for EqUi {
    fn drop(&mut self) {
        if let Some(session) = self.session.clone() {
            session.release_solo();
            session.with_permission(|| self.close_edits(session.context()));
        }
    }
}

fn read_extras(params: &EqParams) -> Extras {
    Extras {
        gain_scale: params.get_plain(3).unwrap_or(1.0),
        phase_invert: params.get_plain(4).unwrap_or(0.0) > 0.5,
        auto_gain: params.get_plain(5).unwrap_or(0.0) > 0.5,
        output_pan: params.get_plain(8).unwrap_or(0.0),
        output_pan_mode: params.get_plain(9).unwrap_or(0.0).round().clamp(0.0, 1.0) as u8,
        output_mute: params.get_plain(10).unwrap_or(0.0) > 0.5,
    }
}

fn peak_db(peak: f32) -> f32 {
    20.0 * peak.max(1.0e-6).log10()
}

fn parse_number(text: &str) -> Option<f64> {
    let value = text.trim().to_lowercase();
    let (value, multiplier) = if let Some(value) = value.strip_suffix('k') {
        (value, 1000.0)
    } else {
        (value.as_str(), 1.0)
    };
    value
        .trim()
        .parse::<f64>()
        .ok()
        .map(|value| value * multiplier)
        .filter(|value| value.is_finite())
}
