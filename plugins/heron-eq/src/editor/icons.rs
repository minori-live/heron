//! Small vector actions keep the graph dominant while tooltips name every task.

use std::time::Duration;

use truce_iced::{
    Message,
    iced::{
        Border, Color, Element, Length, Rectangle, Renderer, Theme, Vector, mouse,
        widget::{
            Canvas, button as iced_button,
            canvas::{self, Frame, Geometry},
            text, tooltip,
        },
    },
};

use super::{EqMessage, style};

#[path = "icon_paths.rs"]
mod paths;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Icon {
    Power,
    More,
    Spectrum,
    Phase,
    Headphones,
    Trash,
    Previous,
    Next,
    Close,
    Copy,
    Paste,
    Duplicate,
    Split,
    Keyboard,
    Snowflake,
    Volume,
    Mute,
    Invert,
    AutoGain,
    Link,
    Collision,
    Midi,
}

pub fn button<'a>(
    icon: Icon,
    hint: impl Into<String>,
    message: EqMessage,
    active: bool,
) -> Element<'a, Message<EqMessage>> {
    button_enabled(icon, hint, message, active, true)
}

pub fn button_enabled<'a>(
    icon: Icon,
    hint: impl Into<String>,
    message: EqMessage,
    active: bool,
    enabled: bool,
) -> Element<'a, Message<EqMessage>> {
    let colors = style::palette();
    // Canvas strokes do not inherit the enclosing button's text color. Choose
    // this explicitly, including disabled actions in the first headless frame.
    let color = if !enabled {
        colors.text_subtle
    } else if active {
        colors.action
    } else {
        colors.text
    };
    let action = iced_button(glyph(icon, 16.0, color))
        .padding(6)
        .width(Length::Fixed(28.0))
        .height(Length::Fixed(28.0))
        .on_press_maybe(enabled.then_some(Message::Plugin(message)))
        .style(move |_, status| {
            let colors = style::palette();
            let selected = enabled && active;
            let background = if selected {
                Some(colors.selection.into())
            } else if enabled {
                match status {
                    iced_button::Status::Hovered => Some(colors.control_hover.into()),
                    iced_button::Status::Pressed => Some(colors.control_pressed.into()),
                    _ => None,
                }
            } else {
                None
            };
            iced_button::Style {
                background,
                text_color: color,
                border: Border {
                    color: if selected {
                        colors.selection_border
                    } else {
                        Color::TRANSPARENT
                    },
                    width: if selected { 1.0 } else { 0.0 },
                    radius: 4.0.into(),
                },
                ..Default::default()
            }
        });
    tooltip(
        action,
        text(hint.into()).size(11).color(colors.text),
        tooltip::Position::Top,
    )
    .delay(Duration::from_millis(325))
    .gap(4)
    .padding(6)
    .snap_within_viewport(true)
    .style(style::panel)
    .into()
}

/// A vector glyph for compound readouts. Callers supply a semantic palette color.
pub fn glyph<'a>(icon: Icon, size: f32, color: Color) -> Element<'a, Message<EqMessage>> {
    let size = if size.is_finite() {
        size.max(1.0)
    } else {
        16.0
    };
    Canvas::new(Glyph { icon, color })
        .width(Length::Fixed(size))
        .height(Length::Fixed(size))
        .into()
}

struct Glyph {
    icon: Icon,
    color: Color,
}

impl canvas::Program<Message<EqMessage>> for Glyph {
    type State = ();

    fn draw(
        &self,
        _state: &Self::State,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        _cursor: mouse::Cursor,
    ) -> Vec<Geometry> {
        let mut frame = Frame::new(renderer, bounds.size());
        let size = bounds.width.min(bounds.height);
        frame.translate(Vector::new(
            (bounds.width - size) * 0.5,
            (bounds.height - size) * 0.5,
        ));
        frame.scale(size / 16.0);
        paths::draw(&mut frame, self.icon, self.color);
        vec![frame.into_geometry()]
    }
}
