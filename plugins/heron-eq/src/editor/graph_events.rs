//! Pointer intent and gesture lifecycle for the EQ canvas.

use super::*;

const DRAG_THRESHOLD_SQUARED: f32 = 16.0;

fn moved(start: Point, end: Point) -> bool {
    let delta = end - start;
    delta.x.mul_add(delta.x, delta.y * delta.y) >= DRAG_THRESHOLD_SQUARED
}

impl GraphState {
    fn clear_pointer(&mut self) -> bool {
        let active = self.drag.is_some() || self.press.is_some();
        self.drag = None;
        self.press = None;
        self.rectangle = None;
        self.last_click = None;
        active
    }
}

impl Graph {
    fn publish(&self, message: GraphMessage) -> Option<canvas::Action<Message<EqMessage>>> {
        Some(
            canvas::Action::publish(Message::Plugin(EqMessage::GraphAt(
                self.restore_revision,
                message,
            )))
            .and_capture(),
        )
    }

    pub(super) fn on_event(
        &self,
        state: &mut GraphState,
        event: &Event,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> Option<canvas::Action<Message<EqMessage>>> {
        if state.restore_revision != self.restore_revision {
            state.clear_pointer();
            state.restore_revision = self.restore_revision;
        }
        // A sibling HUD obscures hover hit-testing, but an existing graph gesture
        // still owns its pointer until release or cancellation.
        let cursor = if state.drag.is_some() || state.press.is_some() {
            cursor.land()
        } else {
            cursor
        };
        let plot = Plot::new(bounds.size(), self.range_db);
        let point = cursor.position_in(bounds);
        match event {
            Event::Keyboard(keyboard::Event::ModifiersChanged(modifiers)) => {
                state.modifiers = *modifiers;
                Some(canvas::Action::request_redraw())
            }
            Event::Keyboard(keyboard::Event::KeyPressed {
                key: keyboard::Key::Named(keyboard::key::Named::Escape),
                ..
            }) => {
                if state.clear_pointer() {
                    self.publish(GraphMessage::Cancel)
                } else {
                    None
                }
            }
            Event::Window(truce_iced::iced::window::Event::Unfocused) => {
                state.modifiers = keyboard::Modifiers::empty();
                if state.clear_pointer() {
                    self.publish(GraphMessage::Cancel)
                } else {
                    Some(canvas::Action::request_redraw())
                }
            }
            Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)) => {
                let position = point.filter(|point| plot.contains(*point))?;
                state.position = Some(position);
                state.press = None;
                state.rectangle = None;
                if let Some(band) = self.hit(plot, position) {
                    state.last_click = None;
                    if state.modifiers.alt()
                        || (state.modifiers.shift() && self.selected.contains(&band.id))
                    {
                        state.press = Some(Press::Band {
                            id: band.id,
                            start: position,
                            frequency: band.frequency_hz,
                            additive: state.modifiers.shift(),
                            solo: state.modifiers.alt(),
                        });
                        return Some(canvas::Action::capture());
                    }
                    state.drag = Some(Drag {
                        start: position,
                        frequency: band.frequency_hz,
                    });
                    return self.publish(GraphMessage::BeginDrag {
                        id: band.id,
                        additive: state.modifiers.shift(),
                        solo: false,
                    });
                }
                let frequency = f64::from(plot.x_frequency(position.x));
                let gain = f64::from(plot.y_gain(position.y));
                if state.modifiers.alt() {
                    state.last_click = None;
                    return self.publish(GraphMessage::Grab(frequency));
                }
                let double = state.last_click.is_some_and(|(time, previous)| {
                    let delta = previous - position;
                    time.elapsed().as_millis() < 400 && delta.x * delta.x + delta.y * delta.y < 64.0
                });
                state.last_click = Some((Instant::now(), position));
                if double {
                    state.last_click = None;
                    return self.publish(GraphMessage::Add {
                        frequency: snap_frequency(frequency, self.snap),
                        gain,
                    });
                }
                state.press = Some(Press::Background {
                    start: position,
                    additive: state.modifiers.shift(),
                });
                Some(canvas::Action::capture())
            }
            Event::Mouse(mouse::Event::CursorMoved { .. }) => {
                let absolute = cursor.position()?;
                let position = Point::new(absolute.x - bounds.x, absolute.y - bounds.y);
                state.position = Some(position);
                if let Some(Press::Band {
                    id,
                    start,
                    frequency,
                    additive,
                    solo,
                }) = &state.press
                {
                    if moved(*start, position) {
                        let id = *id;
                        let additive = *additive;
                        let solo = *solo;
                        state.drag = Some(Drag {
                            start: *start,
                            frequency: *frequency,
                        });
                        state.press = None;
                        return self.publish(GraphMessage::BeginDrag { id, additive, solo });
                    }
                    return Some(canvas::Action::request_redraw().and_capture());
                }
                if let Some(drag) = &state.drag {
                    let ratio =
                        f64::from(plot.x_frequency(position.x) / plot.x_frequency(drag.start.x));
                    let frequency = snap_frequency(drag.frequency * ratio, self.snap);
                    let gain_delta = f64::from(plot.y_gain(position.y) - plot.y_gain(drag.start.y));
                    let (ratio, gain_delta) = if state.modifiers.control() {
                        (1.0, gain_delta)
                    } else if state.modifiers.shift() {
                        (frequency / drag.frequency, 0.0)
                    } else {
                        (frequency / drag.frequency, gain_delta)
                    };
                    return self.publish(GraphMessage::Drag {
                        frequency_ratio: ratio,
                        gain_delta,
                    });
                }
                if let Some(Press::Background { start, .. }) = state.press {
                    if moved(start, position) {
                        state.rectangle = Some(start);
                        state.last_click = None;
                    }
                    return Some(canvas::Action::request_redraw().and_capture());
                }
                Some(canvas::Action::request_redraw())
            }
            Event::Mouse(mouse::Event::CursorLeft) => Some(canvas::Action::request_redraw()),
            Event::Mouse(mouse::Event::ButtonReleased(mouse::Button::Left)) => {
                if state.drag.take().is_some() {
                    state.press = None;
                    return self.publish(GraphMessage::End);
                }
                match state.press.take() {
                    Some(Press::Band { id, solo, .. }) => {
                        if solo {
                            self.publish(GraphMessage::ToggleEnabled(id))
                        } else {
                            self.publish(GraphMessage::SelectArea {
                                ids: self
                                    .selected
                                    .iter()
                                    .copied()
                                    .filter(|selected| *selected != id)
                                    .collect(),
                                additive: false,
                            })
                        }
                    }
                    Some(Press::Background { start, additive }) => {
                        if state.rectangle.take().is_none() {
                            return if additive {
                                Some(canvas::Action::capture())
                            } else {
                                self.publish(GraphMessage::Deselect)
                            };
                        }
                        let end = point.or(state.position).unwrap_or(start);
                        let rectangle = selection_rectangle(start, end);
                        let ids =
                            self.config
                                .bands
                                .iter()
                                .filter(|band| {
                                    rectangle.contains(plot.visible_node(
                                        band.frequency_hz as f32,
                                        band.gain_db as f32,
                                    ))
                                })
                                .map(|band| band.id)
                                .collect();
                        self.publish(GraphMessage::SelectArea { ids, additive })
                    }
                    None => None,
                }
            }
            Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Right)) => {
                let position = point.filter(|point| plot.contains(*point))?;
                let band = self.hit(plot, position)?;
                state.clear_pointer();
                self.publish(GraphMessage::ContextMenu {
                    id: band.id,
                    position: cursor.position()?,
                })
            }
            Event::Mouse(mouse::Event::WheelScrolled { delta }) => {
                let band = self.hit(plot, point?)?;
                let delta = match delta {
                    mouse::ScrollDelta::Lines { y, .. } => *y,
                    mouse::ScrollDelta::Pixels { y, .. } => *y / 40.0,
                };
                self.publish(GraphMessage::Q {
                    id: band.id,
                    delta: f64::from(delta),
                })
            }
            _ => None,
        }
    }

    pub(super) fn interaction(
        &self,
        state: &GraphState,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> mouse::Interaction {
        if state.drag.is_some() {
            return mouse::Interaction::Grabbing;
        }
        let Some(point) = cursor.position_in(bounds) else {
            return mouse::Interaction::default();
        };
        let plot = Plot::new(bounds.size(), self.range_db);
        if !plot.contains(point) {
            return mouse::Interaction::default();
        }
        if self.hit(plot, point).is_some() {
            if state.modifiers.alt() {
                mouse::Interaction::Pointer
            } else {
                mouse::Interaction::Grab
            }
        } else {
            mouse::Interaction::Crosshair
        }
    }
}
