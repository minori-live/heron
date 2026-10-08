//! Selected-band controls stay compact; additional operations are opened on demand.

use std::time::Duration;

use heron_dsp_core::eq::{EqChannel, EqShape, ProcessingMode};
use truce_iced::{
    Message,
    iced::{
        Alignment, Border, Element, Length,
        widget::{Column, Row, Space, button, container, pick_list, text, tooltip},
    },
};

use super::{
    EqMessage, EqUi, Panel,
    choices::{self, Channel, Shape},
    controls::{action, field},
    icons::{self, Icon},
    knobs,
    model::{Model, Number},
    style,
};

pub const WIDTH: f32 = 492.0;
pub const HEIGHT: f32 = 142.0;

/// Only pass/stop filters expose an attenuation slope in dB per octave.
pub fn has_cut_slope(shape: EqShape) -> bool {
    matches!(
        shape,
        EqShape::LowCut | EqShape::HighCut | EqShape::BandPass
    )
}

fn saved_response_notice(shape: EqShape, stored_setting: f64) -> Option<&'static str> {
    if has_cut_slope(shape) || (stored_setting - 12.0).abs() < 1.0e-9 {
        None
    } else if shape == EqShape::FlatTilt {
        Some("Saved tilt response retained")
    } else if stored_setting > 12.0 {
        Some("Cascaded response · saved setting")
    } else {
        Some("Single-stage response · saved setting")
    }
}

pub fn view<'a>(ui: &'a EqUi, model: &Model) -> Element<'a, Message<EqMessage>> {
    let Some(band) = model.focused() else {
        return Space::new().height(0).into();
    };
    let colors = style::palette();
    let supported = knobs::gain_supported(band.shape);
    let label = if model.selected.len() > 1 {
        format!("{} bands", model.selected.len())
    } else {
        format!("Band {}", band.id)
    };
    let header = Row::new()
        .push(icons::button(
            Icon::Power,
            if band.enabled {
                "Bypass selected bands"
            } else {
                "Enable selected bands"
            },
            EqMessage::BandEnabled(!band.enabled),
            band.enabled,
        ))
        .push(icons::button(
            Icon::Headphones,
            "Solo focused band",
            EqMessage::Solo,
            model.solo == Some(band.id),
        ))
        .push(
            text(label)
                .size(12)
                .color(style::band_color(band.id.saturating_sub(1) as usize)),
        )
        .push(Space::new().width(Length::Fill))
        .push(icons::button(
            Icon::More,
            "Band options",
            EqMessage::Menu(Panel::BandActions),
            ui.panel_for_view() == Some(Panel::BandActions),
        ))
        .push(icons::button(
            Icon::Trash,
            "Delete selected bands",
            EqMessage::Delete,
            false,
        ))
        .spacing(5)
        .align_y(Alignment::Center);
    let shape = pick_list(choices::SHAPES, Some(Shape(band.shape)), |shape| {
        Message::Plugin(EqMessage::Shape(shape.0))
    })
    .text_size(11)
    .padding([5, 6])
    .width(Length::Fixed(98.0));
    let mut left = Column::new().push(shape).spacing(7).width(98);
    if has_cut_slope(band.shape) {
        let slopes: Vec<_> = choices::SLOPES
            .into_iter()
            .filter(|slope| {
                slope.0 != 1000 || model.config.processing_mode == ProcessingMode::LinearPhase
            })
            .collect();
        let selected = slopes
            .iter()
            .copied()
            .find(|slope| (f64::from(slope.0) - band.slope_db_oct).abs() < 0.01);
        left = left.push(
            pick_list(slopes, selected, |slope| {
                Message::Plugin(EqMessage::Slope(f64::from(slope.0)))
            })
            .placeholder(format!("{:.1} dB/oct", band.slope_db_oct))
            .text_size(11)
            .padding([5, 6])
            .width(Length::Fixed(98.0)),
        );
    }
    let mut ids: Vec<_> = model.config.bands.iter().collect();
    ids.sort_by(|a, b| {
        a.frequency_hz
            .total_cmp(&b.frequency_hz)
            .then(a.id.cmp(&b.id))
    });
    let index = ids
        .iter()
        .position(|candidate| candidate.id == band.id)
        .unwrap_or(0);
    let previous = ids[(index + ids.len() - 1) % ids.len()].id;
    let next = ids[(index + 1) % ids.len()].id;
    let placement = pick_list(choices::CHANNELS, Some(Channel(band.channel)), |channel| {
        Message::Plugin(EqMessage::Channel(channel.0))
    })
    .text_size(11)
    .padding([5, 6])
    .width(Length::Fixed(94.0));
    let right = Column::new()
        .push(placement)
        .push(
            Row::new()
                .push(icons::button(
                    Icon::Previous,
                    "Previous band by frequency",
                    EqMessage::Select(previous),
                    false,
                ))
                .push(text(format!("{}", band.id)).size(12).color(colors.text))
                .push(icons::button(
                    Icon::Next,
                    "Next band by frequency",
                    EqMessage::Select(next),
                    false,
                ))
                .spacing(5)
                .align_y(Alignment::Center),
        )
        .spacing(8)
        .align_x(Alignment::Center)
        .width(94);
    let body = Row::new()
        .push(left)
        .push(knobs::view(
            ui,
            Number::Frequency,
            band.frequency_hz,
            band.id,
            true,
        ))
        .push(knobs::view(
            ui,
            Number::Gain,
            band.gain_db,
            band.id,
            supported,
        ))
        .push(knobs::view(ui, Number::Q, band.q, band.id, true))
        .push(right)
        .spacing(8)
        .align_y(Alignment::Center);
    container(Column::new().push(header).push(body).spacing(6))
        .id("heron-eq-band-controls")
        .padding([5, 10])
        .width(Length::Fixed(WIDTH))
        .height(Length::Fixed(HEIGHT))
        .style(move |_| container::Style {
            background: Some(colors.surface.into()),
            text_color: Some(colors.text),
            border: Border {
                color: colors.border,
                width: 1.0,
                radius: 7.0.into(),
            },
            ..Default::default()
        })
        .into()
}

pub fn actions<'a>(ui: &'a EqUi, model: &Model) -> Element<'a, Message<EqMessage>> {
    let Some(band) = model.focused() else {
        return Space::new().height(0).into();
    };
    let copy = Row::new()
        .push(menu_action(
            Icon::Duplicate,
            "Duplicate",
            "Duplicate selected bands",
            EqMessage::Duplicate,
            false,
        ))
        .push(menu_action(
            Icon::Copy,
            "Copy",
            "Copy selected bands",
            EqMessage::CopyBands,
            false,
        ))
        .push(menu_action(
            Icon::Paste,
            "Paste",
            "Paste copied bands",
            EqMessage::PasteBands,
            false,
        ))
        .spacing(8);
    let split = Row::new()
        .push(menu_action(
            Icon::Split,
            "Split L/R",
            "Split selected stereo bands into Left and Right",
            EqMessage::SplitChannels(EqChannel::Left, EqChannel::Right),
            false,
        ))
        .push(menu_action(
            Icon::Split,
            "Split M/S",
            "Split selected stereo bands into Mid and Side",
            EqMessage::SplitChannels(EqChannel::Mid, EqChannel::Side),
            false,
        ))
        .push(menu_action(
            Icon::Midi,
            "MIDI",
            "MIDI learn",
            EqMessage::Menu(Panel::Midi),
            false,
        ))
        .spacing(8);
    let mut content = Column::new()
        .push(
            Row::new()
                .push(menu_action(
                    Icon::Power,
                    if band.enabled { "Bypass" } else { "Enable" },
                    if band.enabled {
                        "Bypass selected bands"
                    } else {
                        "Enable selected bands"
                    },
                    EqMessage::BandEnabled(!band.enabled),
                    band.enabled,
                ))
                .push(menu_action(
                    Icon::Headphones,
                    "Solo",
                    "Solo focused band",
                    EqMessage::Solo,
                    model.solo == Some(band.id),
                ))
                .push(menu_action(
                    Icon::Trash,
                    "Delete",
                    "Delete selected bands",
                    EqMessage::Delete,
                    false,
                ))
                .spacing(8),
        )
        .push(copy)
        .push(split)
        .spacing(12);
    if has_cut_slope(band.shape) {
        content = content.push(field(
            ui,
            Number::Slope,
            "Slope · dB/oct",
            band.slope_db_oct,
            125.0,
        ));
    } else if let Some(notice) = saved_response_notice(band.shape, band.slope_db_oct) {
        content = content.push(text(notice).size(11).color(style::palette().text_muted));
    }
    content.into()
}

fn menu_action(
    icon: Icon,
    label: &'static str,
    hint: &'static str,
    message: EqMessage,
    active: bool,
) -> Element<'static, Message<EqMessage>> {
    let colors = style::palette();
    let content = Row::new()
        .push(icons::glyph(
            icon,
            16.0,
            if active { colors.action } else { colors.text },
        ))
        .push(text(label).size(12))
        .spacing(6)
        .align_y(Alignment::Center);
    let action = button(content)
        .height(Length::Fixed(28.0))
        .padding([6, 7])
        .on_press(Message::Plugin(message))
        .style(style::chrome_button(active));
    tooltip(
        action,
        text(hint).size(11).color(colors.text),
        tooltip::Position::Top,
    )
    .delay(Duration::from_millis(325))
    .gap(4)
    .padding(6)
    .snap_within_viewport(true)
    .style(style::panel)
    .into()
}

pub fn midi<'a>(ui: &'a EqUi, model: &Model) -> Element<'a, Message<EqMessage>> {
    let params = ui.active_params();
    let band = model.focused().map_or(1, |band| band.id);
    let targets = choices::midi_targets(&params, band);
    let selected = targets
        .iter()
        .find(|target| Some(target.id) == params.telemetry.learning())
        .cloned();
    Column::new()
        .push(
            pick_list(targets, selected, |target| {
                Message::Plugin(EqMessage::LearnParam(target.id))
            })
            .placeholder("Choose a control, then move a MIDI CC")
            .text_size(12)
            .padding(6)
            .width(Length::Fixed(360.0)),
        )
        .push(
            Row::new()
                .push(action("Clear band bindings", EqMessage::ForgetMidi, false))
                .push(action(
                    "Clear global bindings",
                    EqMessage::ForgetGlobalMidi,
                    false,
                ))
                .spacing(8),
        )
        .spacing(12)
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attenuation_slope_controls_are_available_only_for_pass_and_stop_filters() {
        for shape in [EqShape::LowCut, EqShape::HighCut, EqShape::BandPass] {
            assert!(has_cut_slope(shape));
        }
        for shape in [
            EqShape::Bell,
            EqShape::LowShelf,
            EqShape::HighShelf,
            EqShape::Notch,
            EqShape::TiltShelf,
            EqShape::FlatTilt,
            EqShape::AllPass,
        ] {
            assert!(!has_cut_slope(shape));
            assert!(saved_response_notice(shape, 12.0).is_none());
        }
        assert!(saved_response_notice(EqShape::Bell, 24.0).is_some());
        assert!(saved_response_notice(EqShape::LowShelf, 6.0).is_some());
        assert!(saved_response_notice(EqShape::FlatTilt, 24.0).is_some());
        assert!(saved_response_notice(EqShape::HighCut, 24.0).is_none());
    }
}
