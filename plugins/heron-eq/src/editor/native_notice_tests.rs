//! Focus and continuous-control notice routing through the real native interface.

use super::*;
use core::widget::operation::focusable;
use iced_runtime::user_interface::{Cache, UserInterface};
use truce_iced::iced::widget::core;

#[derive(Default)]
struct InputFocus(Option<bool>);

impl Operation for InputFocus {
    fn traverse(&mut self, operate: &mut dyn FnMut(&mut dyn Operation)) {
        operate(self);
    }

    fn focusable(
        &mut self,
        id: Option<&Id>,
        _bounds: Rectangle,
        state: &mut dyn focusable::Focusable,
    ) {
        if id == Some(&knobs::input_id(Number::Frequency)) {
            self.0 = Some(state.is_focused());
        }
    }
}

pub(super) fn verify_controls(renderer: &mut Renderer, window: Size) {
    use core::Renderer as _;

    let source = Harness::new();
    let mut ui = fit_ui(&source);
    dispatch(&mut ui, &source, EqMessage::Select(1));
    let initial = ui.model.borrow().focused().unwrap().gain_db;
    let params = ParamCache::new(source.params.clone());
    let mut cache = Cache::new();
    let mut origin = None;
    let style = core::renderer::Style {
        text_color: style::palette().text,
    };

    for step in 0..4 {
        if step == 1 {
            ui.notify("Play audio before matching the sidechain.", true);
        }
        let config = ui.model.borrow().config.clone();
        let pending = ui.expected.borrow().clone();
        let edits = ui.edited.clone();
        let host_events = source.events.lock().unwrap().clone();
        let mut messages = Vec::new();
        {
            let mut frame = UserInterface::build(ui.view_editor(&params), window, cache, renderer);
            let mut bounds = ControlsBounds::default();
            frame.operate(renderer, &mut bounds);
            let start = *origin.get_or_insert(bounds.gain.expect("real gain rotary").center());
            let pointer = Point::new(start.x, start.y - if step >= 2 { 18.0 } else { 0.0 });
            let event = match step {
                0 => Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)),
                1 => escape_event(),
                2 => Event::Mouse(mouse::Event::CursorMoved { position: pointer }),
                _ => Event::Mouse(mouse::Event::ButtonReleased(mouse::Button::Left)),
            };
            let (_, statuses) = frame.update(
                &[
                    event,
                    Event::Window(truce_iced::iced::window::Event::RedrawRequested(
                        std::time::Instant::now(),
                    )),
                ],
                mouse::Cursor::Available(pointer),
                renderer,
                &mut core::clipboard::Null,
                &mut messages,
            );
            assert_eq!(statuses[0], truce_iced::iced::event::Status::Captured);
            knobs::reset_paint_trace();
            frame.draw(
                renderer,
                &ui.theme(),
                &style,
                mouse::Cursor::Available(pointer),
            );
            assert_eq!(knobs::painted_controls(), 7);
            cache = frame.into_cache();
        }
        assert_eq!(messages.len(), 1);
        for message in messages {
            let Message::Plugin(intent) = message else {
                panic!("unexpected native rotary notice intent")
            };
            assert!(matches!(
                (&intent, step),
                (
                    EqMessage::KnobAt(_, knobs::KnobMessage::Begin(Number::Gain)),
                    0
                ) | (EqMessage::DismissNotice, 1)
                    | (
                        EqMessage::KnobAt(_, knobs::KnobMessage::Change(Number::Gain, _)),
                        2
                    )
                    | (EqMessage::KnobAt(_, knobs::KnobMessage::End), 3)
            ));
            dispatch(&mut ui, &source, intent);
        }
        if step == 1 {
            assert!(ui.notice.is_none());
            assert_eq!(ui.model.borrow().config, config);
            assert_eq!(*ui.expected.borrow(), pending);
            assert_eq!(ui.edited, edits);
            assert_eq!(*source.events.lock().unwrap(), host_events);
        }
        assert_eq!(ui.model.borrow().has_gesture(), step < 3);
        assert!(
            (ui.model.borrow().focused().unwrap().gain_db
                - initial
                - if step >= 2 { 6.0 } else { 0.0 })
            .abs()
                < 1e-7
        );
    }
    assert!(ui.edited.is_empty());
    for kind in ['b', 'e'] {
        assert_eq!(
            source
                .events
                .lock()
                .unwrap()
                .iter()
                .filter(|(event, id)| *event == kind && *id == crate::params::BAND_BASE + 4)
                .count(),
            1
        );
    }

    dispatch(
        &mut ui,
        &source,
        EqMessage::Knob(knobs::KnobMessage::Edit(Number::Frequency)),
    );
    ui.notify("Play audio before matching the sidechain.", true);
    let config = ui.model.borrow().config.clone();
    let host_events = source.events.lock().unwrap().clone();
    let mut messages = Vec::new();
    {
        let mut frame = UserInterface::build(ui.view_editor(&params), window, cache, renderer);
        frame.operate(
            renderer,
            &mut focusable::focus::<()>(knobs::input_id(Number::Frequency)),
        );
        let mut focus = InputFocus::default();
        frame.operate(renderer, &mut focus);
        assert_eq!(focus.0, Some(true), "the real numeric input is focused");
        let (_, statuses) = frame.update(
            &[escape_event()],
            mouse::Cursor::Unavailable,
            renderer,
            &mut core::clipboard::Null,
            &mut messages,
        );
        assert_eq!(statuses[0], truce_iced::iced::event::Status::Captured);
        frame.operate(renderer, &mut focus);
        assert_eq!(focus.0, Some(true), "notice Escape cannot reach TextInput");
        frame.draw(renderer, &ui.theme(), &style, mouse::Cursor::Unavailable);
        cache = frame.into_cache();
    }
    assert!(matches!(
        messages.as_slice(),
        [Message::Plugin(EqMessage::DismissNotice)]
    ));
    dispatch(&mut ui, &source, EqMessage::DismissNotice);
    assert_eq!(ui.numeric_edit, Some(Number::Frequency));
    assert_eq!(ui.model.borrow().config, config);
    assert_eq!(*source.events.lock().unwrap(), host_events);
    {
        let mut frame = UserInterface::build(ui.view_editor(&params), window, cache, renderer);
        let mut focus = InputFocus::default();
        frame.operate(renderer, &mut focus);
        assert_eq!(
            focus.0,
            Some(true),
            "dismissing the notice retains input focus"
        );
        frame.draw(renderer, &ui.theme(), &style, mouse::Cursor::Unavailable);
    }
    renderer.reset(Rectangle::new(Point::ORIGIN, window));
}
