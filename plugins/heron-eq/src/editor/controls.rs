use truce_iced::{
    Message,
    iced::{
        Alignment, Border, Element, Length, Theme,
        widget::{Column, Row, button, pick_list, slider, text, text_input},
    },
};

use super::{
    EqMessage, EqUi, choices,
    icons::{self, Icon},
    model::Number,
    style::{self, active_button},
};

type UiElement<'a> = Element<'a, Message<EqMessage>>;

pub fn input_style(_: &Theme, status: text_input::Status) -> text_input::Style {
    let colors = style::palette();
    text_input::Style {
        background: colors.control.into(),
        border: Border {
            color: if matches!(status, text_input::Status::Focused { .. }) {
                colors.focus
            } else {
                colors.border_strong
            },
            width: 1.0,
            radius: 3.0.into(),
        },
        icon: colors.text_muted,
        placeholder: colors.text_subtle,
        value: colors.text,
        selection: colors.selection,
    }
}

pub fn action<'a>(
    label: impl Into<String>,
    message: EqMessage,
    active: bool,
) -> truce_iced::iced::widget::Button<'a, Message<EqMessage>> {
    button(text(label.into()).size(12.0))
        .padding([6, 10])
        .on_press(Message::Plugin(message))
        .style(active_button(active))
}

pub(super) fn field<'a>(
    ui: &EqUi,
    field: Number,
    label: &'static str,
    value: f64,
    width: f32,
) -> UiElement<'a> {
    let value = ui
        .draft_for_view(field)
        .cloned()
        .unwrap_or_else(|| match field {
            Number::Frequency => format!("{value:.1}"),
            Number::Q => format!("{value:.3}"),
            _ => format!("{value:.2}"),
        });
    Column::new()
        .push(text(label).size(11).color(style::palette().text_muted))
        .push(
            text_input("", &value)
                .id(super::knobs::input_id(field))
                .style(input_style)
                .size(12)
                .padding(6)
                .on_input(move |value| Message::Plugin(EqMessage::Draft(field, value)))
                .on_submit(Message::Plugin(EqMessage::Submit(field))),
        )
        .spacing(4)
        .width(Length::Fixed(width))
        .into()
}

pub fn inspector<'a>(ui: &'a EqUi, model: &super::model::Model) -> UiElement<'a> {
    super::band_controls::view(ui, model)
}
pub fn band_actions<'a>(ui: &'a EqUi, model: &super::model::Model) -> UiElement<'a> {
    super::band_controls::actions(ui, model)
}
pub fn midi<'a>(ui: &'a EqUi, model: &super::model::Model) -> UiElement<'a> {
    super::band_controls::midi(ui, model)
}

pub fn output<'a>(ui: &'a EqUi, model: &super::model::Model) -> UiElement<'a> {
    let colors = style::palette();
    let scale = Column::new()
        .push(
            text(format!(
                "Gain scale {:.0}%",
                model.extras.gain_scale * 100.0
            ))
            .size(11)
            .color(colors.text_muted),
        )
        .push(
            slider(0.0..=2.0, model.extras.gain_scale, |value| {
                Message::Plugin(EqMessage::GainScale(value))
            })
            .step(0.01)
            .on_release(Message::Plugin(EqMessage::EndControl)),
        )
        .spacing(6)
        .width(Length::Fixed(160.0));
    let level = Row::new()
        .push(field(
            ui,
            Number::Output,
            "Output · dB",
            model.config.output_gain_db,
            100.0,
        ))
        .push(scale)
        .push(icons::button(
            Icon::Mute,
            if model.extras.output_mute {
                "Unmute output"
            } else {
                "Mute output"
            },
            EqMessage::OutputMute(!model.extras.output_mute),
            model.extras.output_mute,
        ))
        .spacing(12)
        .align_y(Alignment::Center);
    let pan = Row::new()
        .push(
            pick_list(
                choices::PAN_MODES,
                Some(choices::PanMode(model.extras.output_pan_mode)),
                |mode| Message::Plugin(EqMessage::PanMode(mode.0)),
            )
            .text_size(12)
            .padding(6)
            .width(Length::Fixed(95.0)),
        )
        .push(
            slider(-1.0..=1.0, model.extras.output_pan, |value| {
                Message::Plugin(EqMessage::Pan(value))
            })
            .step(0.01)
            .on_release(Message::Plugin(EqMessage::EndControl))
            .width(Length::Fixed(150.0)),
        )
        .push(field(
            ui,
            Number::Pan,
            "Pan · -1 / +1",
            model.extras.output_pan,
            85.0,
        ))
        .spacing(12)
        .align_y(Alignment::Center);
    let options = Row::new()
        .push(icons::button(
            Icon::AutoGain,
            if model.extras.auto_gain {
                "Disable auto gain"
            } else {
                "Enable auto gain"
            },
            EqMessage::AutoGain(!model.extras.auto_gain),
            model.extras.auto_gain,
        ))
        .push(icons::button(
            Icon::Invert,
            if model.extras.phase_invert {
                "Restore output polarity"
            } else {
                "Invert output polarity"
            },
            EqMessage::PhaseInvert(!model.extras.phase_invert),
            model.extras.phase_invert,
        ))
        .spacing(8);
    Column::new()
        .push(level)
        .push(pan)
        .push(options)
        .spacing(14)
        .width(Length::Fixed(400.0))
        .into()
}

pub fn analyzer(ui: &EqUi) -> UiElement<'_> {
    let colors = style::palette();
    let config = ui.active_params().telemetry.analyzer_config();
    let spectra = Row::new()
        .push(action("Pre", EqMessage::Pre, ui.pre))
        .push(action("Post", EqMessage::Post, ui.post))
        .push(action("External", EqMessage::External, ui.external))
        .push(icons::button(
            Icon::Snowflake,
            if ui.frozen.is_some() {
                "Unfreeze spectrum"
            } else {
                "Freeze spectrum"
            },
            EqMessage::Freeze,
            ui.frozen.is_some(),
        ))
        .spacing(8);
    let fft = Column::new()
        .push(text("Resolution").size(11).color(colors.text_muted))
        .push(
            pick_list(
                choices::FFT_SIZES,
                Some(choices::FftSize(config.resolution)),
                |size| Message::Plugin(EqMessage::AnalyzerResolution(size.0)),
            )
            .text_size(12)
            .padding(6)
            .width(Length::Fixed(115.0)),
        )
        .spacing(4);
    let speed = Column::new()
        .push(text("Speed").size(11).color(colors.text_muted))
        .push(
            pick_list(
                choices::SPEEDS,
                Some(choices::Speed(config.speed)),
                |speed| Message::Plugin(EqMessage::AnalyzerSpeed(speed.0)),
            )
            .text_size(12)
            .padding(6)
            .width(Length::Fixed(115.0)),
        )
        .spacing(4);
    let floor = Column::new()
        .push(text("Range").size(11).color(colors.text_muted))
        .push(
            pick_list(
                choices::FLOORS,
                Some(choices::SpectrumFloor(ui.floor)),
                |floor| Message::Plugin(EqMessage::SpectrumFloor(floor.0)),
            )
            .text_size(12)
            .padding(6)
            .width(Length::Fixed(115.0)),
        )
        .spacing(4);
    let detail = Row::new().push(fft).push(speed).push(floor).spacing(12);
    let tilt = Row::new()
        .push(text(format!("Tilt {:.1} dB/oct", config.tilt_db_oct)).size(12))
        .push(
            slider(0.0..=6.0, config.tilt_db_oct, |tilt| {
                Message::Plugin(EqMessage::AnalyzerTilt(tilt))
            })
            .step(0.5_f32)
            .width(Length::Fixed(135.0)),
        )
        .push(icons::button(
            Icon::Collision,
            if ui.collision {
                "Hide spectrum collisions"
            } else {
                "Show spectrum collisions"
            },
            EqMessage::Collision,
            ui.collision,
        ))
        .spacing(12)
        .align_y(Alignment::Center);
    Column::new()
        .push(spectra)
        .push(detail)
        .push(tilt)
        .spacing(14)
        .width(Length::Fixed(400.0))
        .into()
}
