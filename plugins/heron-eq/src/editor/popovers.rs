//! Secondary settings opened from chrome or the selected-band panel.
use super::{
    EqMessage, EqUi, Panel, choices,
    chrome::entry,
    controls,
    icons::{self, Icon},
    model::Model,
    style,
};
use truce_iced::{
    Message,
    iced::{
        Alignment, Element, Length,
        widget::{Column, Row, Space, container, pick_list, text},
    },
};

pub fn view<'a>(
    ui: &'a EqUi,
    model: &Model,
    panel: Panel,
    preview_pending: bool,
    preview_failed: bool,
) -> Element<'a, Message<EqMessage>> {
    let (title, width) = match panel {
        Panel::Processing => ("Processing mode", 280.0),
        Panel::Analyzer => ("Analyzer", 490.0),
        Panel::Output => ("Output", 490.0),
        Panel::Tools => ("Display & tools", 310.0),
        Panel::BandActions => ("Band options", 444.0),
        Panel::Midi => ("MIDI learn", 444.0),
    };
    let body: Element<'a, Message<EqMessage>> = match panel {
        Panel::Processing => processing(ui, model, preview_pending, preview_failed),
        Panel::Analyzer => analyzer(ui),
        Panel::Output => controls::output(ui, model),
        Panel::Tools => tools(ui),
        Panel::BandActions => controls::band_actions(ui, model),
        Panel::Midi => controls::midi(ui, model),
    };
    let heading = Row::new()
        .push(text(title).size(13).color(style::palette().text))
        .push(Space::new().width(Length::Fill))
        .push(icons::button(
            Icon::Close,
            format!("Close {title}"),
            EqMessage::DismissPanels,
            false,
        ))
        .align_y(Alignment::Center);
    let content = Column::new().push(heading).push(body).spacing(10);
    container(content)
        .width(Length::Fixed(width))
        .padding(12)
        .style(style::panel)
        .into()
}

fn processing<'a>(
    ui: &EqUi,
    model: &Model,
    preview_pending: bool,
    preview_failed: bool,
) -> Element<'a, Message<EqMessage>> {
    let mut options = Column::new().spacing(4);
    for mode in choices::MODES {
        options = options.push(
            entry(
                mode.to_string(),
                EqMessage::Mode(mode.0),
                model.config.processing_mode == mode.0,
            )
            .width(Length::Fill),
        );
    }
    if model.config.processing_mode == heron_dsp_core::eq::ProcessingMode::LinearPhase {
        options = options
            .push(
                text("Resolution")
                    .size(11)
                    .color(style::palette().text_muted),
            )
            .push(
                pick_list(
                    choices::RESOLUTIONS,
                    Some(choices::Resolution(model.config.linear_phase_resolution)),
                    |resolution| Message::Plugin(EqMessage::Resolution(resolution.0)),
                )
                .text_size(12)
                .padding(6)
                .width(Length::Fill),
            );
    }
    let telemetry = &ui.active_params().telemetry;
    if let Some(error) = telemetry.processing_error() {
        options = options.push(
            text(error.to_owned())
                .size(11)
                .color(style::palette().danger),
        );
    } else if telemetry.processing_pending() {
        options = options.push(
            text("Preparing the selected response…")
                .size(11)
                .color(style::palette().warning),
        );
    } else if preview_failed {
        options = options.push(
            text("The curve preview could not be prepared.")
                .size(11)
                .color(style::palette().danger),
        );
    } else if preview_pending {
        options = options.push(
            text("Preparing the current curve…")
                .size(11)
                .color(style::palette().warning),
        );
    }
    options.into()
}

fn analyzer(ui: &EqUi) -> Element<'_, Message<EqMessage>> {
    Column::new()
        .push(controls::analyzer(ui))
        .push(icons::button(
            Icon::Link,
            "Fit EQ to sidechain spectrum",
            EqMessage::Match,
            false,
        ))
        .spacing(10)
        .into()
}

fn tools(ui: &EqUi) -> Element<'_, Message<EqMessage>> {
    let mut options = Column::new().spacing(8).push(
        Row::new()
            .push(icons::button(
                Icon::Keyboard,
                "Piano / frequency snap",
                EqMessage::Piano,
                ui.piano,
            ))
            .push(icons::button(
                Icon::Paste,
                "Paste bands · append clipboard bands",
                EqMessage::PasteBands,
                false,
            ))
            .spacing(8),
    );
    options = options
        .push(
            text("Display range")
                .size(11)
                .color(style::palette().text_muted),
        )
        .push(
            pick_list(choices::RANGES, Some(choices::Range(ui.range)), |range| {
                Message::Plugin(EqMessage::Range(range.0))
            })
            .text_size(12)
            .padding(6)
            .width(Length::Fill),
        )
        .push(
            text("Display channel")
                .size(11)
                .color(style::palette().text_muted),
        )
        .push(
            pick_list(
                choices::CHANNELS,
                Some(choices::Channel(ui.channel)),
                |channel| Message::Plugin(EqMessage::ViewChannel(channel.0)),
            )
            .text_size(12)
            .padding(6)
            .width(Length::Fill),
        );
    options.into()
}
