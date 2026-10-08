//! EQ-specific rotary gestures retain selection, cancellation and host automation.

use heron_dsp_core::eq::EqShape;
use truce_iced::{
    Message,
    iced::{
        Alignment, Color, Element, Length, Point, Rectangle, Renderer, Theme, keyboard, mouse,
        widget::{
            Canvas, Column, button,
            canvas::{self, Event, Frame, Geometry, LineCap, Path, Stroke, path::Arc},
            container, text, text_input,
        },
    },
};

use super::{EqMessage, EqUi, model::Number, style};

const START: f32 = std::f32::consts::PI * 0.75;
const END: f32 = std::f32::consts::PI * 2.25;

#[cfg(test)]
thread_local! {
    static PAINTED_KNOBS: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(super) fn reset_paint_trace() {
    PAINTED_KNOBS.with(|painted| painted.set(0));
}

#[cfg(test)]
pub(super) fn painted_controls() -> u8 {
    PAINTED_KNOBS.with(std::cell::Cell::get)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum KnobMessage {
    Begin(Number),
    Change(Number, f64),
    End,
    Cancel,
    Edit(Number),
    Step(Number, f64),
    Reset(Number),
}

pub fn input_id(field: Number) -> truce_iced::iced::widget::Id {
    truce_iced::iced::widget::Id::new(match field {
        Number::Frequency => "heron-eq-frequency",
        Number::Gain => "heron-eq-gain",
        Number::Q => "heron-eq-q",
        Number::Output => "heron-eq-output",
        Number::Pan => "heron-eq-pan",
        Number::Slope => "heron-eq-slope",
    })
}

#[derive(Clone, Copy)]
struct Domain {
    minimum: f64,
    maximum: f64,
    logarithmic: bool,
}

impl Domain {
    fn for_field(field: Number, maximum_frequency: f64) -> Self {
        let (minimum, maximum, logarithmic) = match field {
            Number::Frequency => (10.0, maximum_frequency.max(10.0), true),
            Number::Q => (0.025, 40.0, true),
            _ => (-30.0, 30.0, false),
        };
        Self {
            minimum,
            maximum,
            logarithmic,
        }
    }

    fn normalize(self, value: f64) -> f64 {
        let value = value.clamp(self.minimum, self.maximum);
        if self.logarithmic {
            (value / self.minimum).ln() / (self.maximum / self.minimum).ln()
        } else {
            (value - self.minimum) / (self.maximum - self.minimum)
        }
    }

    fn value(self, normalized: f64) -> f64 {
        let normalized = normalized.clamp(0.0, 1.0);
        if self.logarithmic {
            self.minimum * (self.maximum / self.minimum).powf(normalized)
        } else {
            self.minimum + (self.maximum - self.minimum) * normalized
        }
    }
}

pub fn gain_supported(shape: EqShape) -> bool {
    matches!(
        shape,
        EqShape::Bell
            | EqShape::LowShelf
            | EqShape::HighShelf
            | EqShape::TiltShelf
            | EqShape::FlatTilt
    )
}

pub fn view<'a>(
    ui: &'a EqUi,
    field: Number,
    value: f64,
    band_id: u32,
    enabled: bool,
) -> Element<'a, Message<EqMessage>> {
    let colors = style::palette();
    let label = match field {
        Number::Frequency => "Frequency",
        Number::Gain => "Gain",
        _ => "Q",
    };
    let maximum = (ui.active_params().telemetry.sample_rate() * 0.499).min(30_000.0);
    let mut column = Column::new()
        .push(text(label).size(11).color(colors.text_muted))
        .push(
            container(
                Canvas::new(Rotary {
                    restore_revision: ui.last_restore_revision.get(),
                    field,
                    value,
                    band_id,
                    enabled,
                    domain: Domain::for_field(field, maximum),
                })
                .width(Length::Fixed(72.0))
                .height(Length::Fixed(62.0)),
            )
            .id(match field {
                Number::Frequency => "heron-eq-frequency-knob",
                Number::Gain => "heron-eq-gain-knob",
                _ => "heron-eq-q-knob",
            }),
        )
        .align_x(Alignment::Center)
        .spacing(1)
        .width(Length::Fixed(78.0));
    if ui.numeric_for_view() == Some(field) && enabled {
        let draft = ui
            .draft_for_view(field)
            .cloned()
            .unwrap_or_else(|| format!("{value:.3}"));
        column = column.push(
            text_input("", &draft)
                .id(input_id(field))
                .style(super::controls::input_style)
                .size(12)
                .padding([2, 4])
                .on_input(move |value| Message::Plugin(EqMessage::Draft(field, value)))
                .on_submit(Message::Plugin(EqMessage::Submit(field))),
        );
    } else {
        let display = match field {
            Number::Frequency if value >= 1000.0 => format!("{:.2} kHz", value / 1000.0),
            Number::Frequency => format!("{value:.1} Hz"),
            Number::Gain => format!("{value:+.2} dB"),
            _ => format!("{value:.3}"),
        };
        let mut readout = button(text(display).size(12))
            .padding([2, 4])
            .style(move |_, _| truce_iced::iced::widget::button::Style {
                text_color: if enabled {
                    colors.text
                } else {
                    colors.text_muted
                },
                ..Default::default()
            });
        if enabled {
            readout = readout.on_press(Message::Plugin(EqMessage::Knob(KnobMessage::Edit(field))));
        }
        column = column.push(readout);
    }
    column.into()
}

struct Rotary {
    restore_revision: u64,
    field: Number,
    value: f64,
    band_id: u32,
    enabled: bool,
    domain: Domain,
}

#[derive(Default)]
pub struct RotaryState {
    restore_revision: u64,
    band_id: Option<u32>,
    drag: Option<(Number, f64, f32)>,
    modifiers: keyboard::Modifiers,
    last_click: Option<mouse::Click>,
}

impl Rotary {
    fn hit_field(&self, point: Point, bounds: Rectangle) -> Option<Number> {
        if !self.enabled {
            return None;
        }
        let center = Point::new(bounds.width * 0.5, bounds.height * 0.5);
        let distance = point.distance(center);
        if distance > 32.0 {
            return None;
        }
        Some(self.field)
    }

    fn wheel_value(&self, field: Number, lines: f64, fine: bool) -> f64 {
        let lines = lines * if fine { 0.1 } else { 1.0 };
        let value = self.value;
        let value = match field {
            Number::Frequency => value * 2.0_f64.powf(lines / 12.0),
            Number::Q => value * 1.12_f64.powf(lines),
            _ => value + lines * 0.5,
        };
        value.clamp(self.domain.minimum, self.domain.maximum)
    }
}

impl canvas::Program<Message<EqMessage>> for Rotary {
    type State = RotaryState;

    fn draw(
        &self,
        state: &Self::State,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> Vec<Geometry> {
        #[cfg(test)]
        PAINTED_KNOBS.with(|painted| {
            let bit = match self.field {
                Number::Frequency => 1,
                Number::Gain => 2,
                Number::Q => 4,
                _ => 0,
            };
            painted.set(painted.get() | bit);
        });
        let colors = style::palette();
        let mut frame = Frame::new(renderer, bounds.size());
        let center = Point::new(bounds.width * 0.5, bounds.height * 0.5);
        let hovered = cursor
            .position_in(bounds)
            .and_then(|point| self.hit_field(point, bounds));
        let arc = |radius: f32, from: f32, to: f32| {
            Path::new(|path| {
                path.arc(Arc {
                    center,
                    radius,
                    start_angle: truce_iced::iced::Radians(from),
                    end_angle: truce_iced::iced::Radians(to),
                });
            })
        };
        let stroke = |color: Color, width| {
            Stroke::default()
                .with_color(color)
                .with_width(width)
                .with_line_cap(LineCap::Round)
        };
        frame.fill(
            &Path::circle(Point::new(center.x, center.y + 2.0), 23.0),
            Color::from_rgba(0.0, 0.0, 0.0, 0.3),
        );
        frame.fill(&Path::circle(center, 23.0), colors.control);
        frame.fill(&Path::circle(center, 19.0), colors.surface);
        frame.stroke(&arc(23.0, START, END), stroke(colors.border, 2.5));
        let angle = START + self.domain.normalize(self.value) as f32 * (END - START);
        let zero = if self.field == Number::Gain {
            (START + END) * 0.5
        } else {
            START
        };
        frame.stroke(
            &arc(23.0, zero.min(angle), zero.max(angle)),
            stroke(
                if self.enabled {
                    colors.action
                } else {
                    colors.text_muted
                },
                2.5,
            ),
        );
        frame.stroke(
            &Path::line(
                center,
                Point::new(center.x + angle.cos() * 16.0, center.y + angle.sin() * 16.0),
            ),
            stroke(
                if self.enabled {
                    colors.text
                } else {
                    colors.text_muted
                },
                2.0,
            ),
        );
        if hovered.is_some() || state.drag.is_some() {
            frame.stroke(&arc(25.0, START, END), stroke(colors.focus, 1.0));
        }
        vec![frame.into_geometry()]
    }

    fn update(
        &self,
        state: &mut Self::State,
        event: &Event,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> Option<canvas::Action<Message<EqMessage>>> {
        if state.band_id != Some(self.band_id) || state.restore_revision != self.restore_revision {
            state.restore_revision = self.restore_revision;
            state.band_id = Some(self.band_id);
            state.drag = None;
            state.last_click = None;
        }
        let publish = |message| {
            Some(
                canvas::Action::publish(Message::Plugin(EqMessage::KnobAt(
                    self.restore_revision,
                    message,
                )))
                .and_capture(),
            )
        };
        match event {
            Event::Window(truce_iced::iced::window::Event::Unfocused)
                if state.drag.take().is_some() =>
            {
                state.last_click = None;
                publish(KnobMessage::Cancel)
            }
            Event::Keyboard(keyboard::Event::KeyPressed {
                key: keyboard::Key::Named(keyboard::key::Named::Escape),
                ..
            }) if state.drag.take().is_some() => {
                state.last_click = None;
                publish(KnobMessage::Cancel)
            }
            Event::Keyboard(keyboard::Event::ModifiersChanged(modifiers)) => {
                state.modifiers = *modifiers;
                None
            }
            Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)) => {
                let position = cursor.position_in(bounds)?;
                let field = self.hit_field(position, bounds)?;
                if state.modifiers.command() || state.modifiers.control() {
                    return publish(KnobMessage::Reset(field));
                }
                let click = mouse::Click::new(position, mouse::Button::Left, state.last_click);
                state.last_click = Some(click);
                if click.kind() == mouse::click::Kind::Double {
                    return publish(KnobMessage::Edit(field));
                }
                state.drag = Some((field, self.value, cursor.position()?.y));
                publish(KnobMessage::Begin(field))
            }
            Event::Mouse(mouse::Event::CursorMoved { .. }) if state.drag.is_some() => {
                let (field, initial, start_y) = state.drag?;
                let fine = if state.modifiers.shift() { 0.1 } else { 1.0 };
                let delta = f64::from(start_y - cursor.position()?.y) * fine / 180.0;
                publish(KnobMessage::Change(
                    field,
                    self.domain.value(self.domain.normalize(initial) + delta),
                ))
            }
            Event::Mouse(mouse::Event::CursorMoved { .. }) => {
                Some(canvas::Action::request_redraw())
            }
            Event::Mouse(mouse::Event::ButtonReleased(mouse::Button::Left))
                if state.drag.take().is_some() =>
            {
                publish(KnobMessage::End)
            }
            Event::Mouse(mouse::Event::WheelScrolled { delta }) => {
                let field = self.hit_field(cursor.position_in(bounds)?, bounds)?;
                let lines = match delta {
                    mouse::ScrollDelta::Lines { y, .. } => f64::from(*y),
                    mouse::ScrollDelta::Pixels { y, .. } => f64::from(*y) / 40.0,
                };
                publish(KnobMessage::Step(
                    field,
                    self.wheel_value(field, lines, state.modifiers.shift()),
                ))
            }
            _ => None,
        }
    }

    fn mouse_interaction(
        &self,
        state: &Self::State,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> mouse::Interaction {
        if state.drag.is_some() {
            mouse::Interaction::Grabbing
        } else if cursor
            .position_in(bounds)
            .and_then(|point| self.hit_field(point, bounds))
            .is_some()
        {
            mouse::Interaction::Grab
        } else {
            mouse::Interaction::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use truce_iced::iced::widget::canvas::Program;

    #[test]
    fn dragging_a_rotary_preserves_relative_group_frequency() {
        use super::super::model::Model;
        use heron_dsp_core::eq::EqConfig;
        let rotary = Rotary {
            restore_revision: 0,
            field: Number::Frequency,
            value: 1000.0,
            band_id: 1,
            enabled: true,
            domain: Domain::for_field(Number::Frequency, 30_000.0),
        };
        let mut model = Model::new(EqConfig::default());
        model.config.bands.clear();
        model.add(1000.0, 0.0);
        model.add(2000.0, 0.0);
        model.selected = [1, 2].into_iter().collect();
        let mut state = RotaryState::default();
        let bounds = Rectangle::new(
            Point::new(10.0, 20.0),
            truce_iced::iced::Size::new(72.0, 62.0),
        );
        for (event, position) in [
            (
                mouse::Event::ButtonPressed(mouse::Button::Left),
                Point::new(46.0, 51.0),
            ),
            (
                mouse::Event::CursorMoved {
                    position: Point::new(46.0, 33.0),
                },
                Point::new(46.0, 33.0),
            ),
            (
                mouse::Event::CursorMoved {
                    position: Point::new(46.0, 15.0),
                },
                Point::new(46.0, 15.0),
            ),
            (
                mouse::Event::ButtonReleased(mouse::Button::Left),
                Point::new(300.0, 200.0),
            ),
        ] {
            let action = rotary
                .update(
                    &mut state,
                    &Event::Mouse(event),
                    bounds,
                    mouse::Cursor::Available(position),
                )
                .expect("rotary gesture");
            match action.into_inner().0.expect("EQ edit") {
                Message::Plugin(EqMessage::KnobAt(_, KnobMessage::Begin(_))) => model.begin(),
                Message::Plugin(EqMessage::KnobAt(_, KnobMessage::Change(field, value))) => {
                    model.knob(field, value)
                }
                Message::Plugin(EqMessage::KnobAt(_, KnobMessage::End)) => model.end(),
                other => panic!("unexpected EQ edit: {other:?}"),
            }
        }
        assert!(model.config.bands[0].frequency_hz > 1000.0);
        assert!(
            (model.config.bands[1].frequency_hz / model.config.bands[0].frequency_hz - 2.0).abs()
                < 1.0e-9
        );
        assert!(!model.has_gesture());
    }

    #[test]
    fn focus_loss_cancels_rotary_and_subsequent_pointer_motion_cannot_resume_it() {
        let rotary = Rotary {
            restore_revision: 0,
            field: Number::Gain,
            value: 3.0,
            band_id: 1,
            enabled: true,
            domain: Domain::for_field(Number::Gain, 30_000.0),
        };
        let mut state = RotaryState::default();
        let bounds = Rectangle::new(Point::ORIGIN, truce_iced::iced::Size::new(72.0, 62.0));
        let cursor = mouse::Cursor::Available(Point::new(36.0, 31.0));
        rotary
            .update(
                &mut state,
                &Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)),
                bounds,
                cursor,
            )
            .expect("begin");
        let cancel = rotary
            .update(
                &mut state,
                &Event::Window(truce_iced::iced::window::Event::Unfocused),
                bounds,
                cursor,
            )
            .expect("cancel");
        assert!(matches!(
            cancel.into_inner().0,
            Some(Message::Plugin(EqMessage::KnobAt(_, KnobMessage::Cancel)))
        ));
        assert!(
            rotary
                .update(
                    &mut state,
                    &Event::Mouse(mouse::Event::CursorMoved {
                        position: Point::new(36.0, 0.0)
                    }),
                    bounds,
                    cursor
                )
                .and_then(|action| action.into_inner().0)
                .is_none()
        );
    }
    #[test]
    fn rotary_mapping_retains_octave_spacing_and_fine_gain_steps() {
        let rotary = Rotary {
            restore_revision: 0,
            field: Number::Frequency,
            value: 1000.0,
            band_id: 1,
            enabled: true,
            domain: Domain::for_field(Number::Frequency, 23952.0),
        };
        assert!((rotary.wheel_value(Number::Frequency, 12.0, false) - 2000.0).abs() < 1.0e-8);
        assert_eq!(
            rotary.wheel_value(Number::Frequency, 1000.0, false),
            23952.0
        );
        let gain = Rotary {
            field: Number::Gain,
            value: 0.0,
            domain: Domain::for_field(Number::Gain, 30_000.0),
            ..rotary
        };
        assert_eq!(gain.wheel_value(Number::Gain, 1.0, true), 0.05);
        assert!((gain.domain.value(gain.domain.normalize(-7.5)) + 7.5).abs() < 1.0e-8);
    }

    #[test]
    fn host_restore_clears_the_rotary_pointer_without_applying_the_old_drag_or_double_click() {
        let mut rotary = Rotary {
            restore_revision: 0,
            field: Number::Gain,
            value: 3.0,
            band_id: 1,
            enabled: true,
            domain: Domain::for_field(Number::Gain, 30_000.0),
        };
        let mut state = RotaryState::default();
        let bounds = Rectangle::new(Point::ORIGIN, truce_iced::iced::Size::new(72.0, 62.0));
        let start = Point::new(36.0, 31.0);
        rotary
            .update(
                &mut state,
                &Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)),
                bounds,
                mouse::Cursor::Available(start),
            )
            .expect("begin");
        rotary.restore_revision = 1;
        rotary.value = -6.0;
        for event in [
            mouse::Event::CursorMoved {
                position: Point::new(36.0, 0.0),
            },
            mouse::Event::ButtonReleased(mouse::Button::Left),
        ] {
            assert!(
                rotary
                    .update(
                        &mut state,
                        &Event::Mouse(event),
                        bounds,
                        mouse::Cursor::Available(start)
                    )
                    .and_then(|action| action.into_inner().0)
                    .is_none()
            );
        }
        assert!(matches!(
            rotary
                .update(
                    &mut state,
                    &Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)),
                    bounds,
                    mouse::Cursor::Available(start)
                )
                .and_then(|action| action.into_inner().0),
            Some(Message::Plugin(EqMessage::KnobAt(
                1,
                KnobMessage::Begin(Number::Gain)
            )))
        ));
    }
}
