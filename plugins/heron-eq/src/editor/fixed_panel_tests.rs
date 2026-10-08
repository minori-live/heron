//! Exercise the production stack/menus and retained widget tree with a real renderer.
//! The existing native render helper supplies the renderer, avoiding another GPU setup.
use super::*;
use core::{
    Shell,
    layout::{Layout, Limits},
    widget::{Id, Operation, Tree},
};
use truce_iced::iced::{Point, Rectangle, Renderer, Size, Vector, mouse, widget::core};

#[path = "native_notice_tests.rs"]
mod notice_controls;
#[path = "native_resize_tests.rs"]
mod resize;

#[derive(Default)]
struct ControlsBounds {
    hud: Option<Rectangle>,
    gain: Option<Rectangle>,
}
impl Operation for ControlsBounds {
    fn traverse(&mut self, operate: &mut dyn FnMut(&mut dyn Operation)) {
        operate(self);
    }
    fn container(&mut self, id: Option<&Id>, bounds: Rectangle) {
        if id == Some(&Id::new("heron-eq-band-controls")) {
            self.hud = Some(bounds);
        }
        if id == Some(&Id::new("heron-eq-gain-knob")) {
            self.gain = Some(bounds);
        }
    }
}

pub(in super::super) fn verify_widget_drag(renderer: &mut Renderer, window: Size) {
    verify_rotary_drag(renderer, window);
    verify_node_frames(renderer, window);
    notice_controls::verify_controls(renderer, window);
    if window.width == 1120.0 {
        resize::verify_retained_resize(renderer);
    }
}

fn verify_rotary_drag(renderer: &Renderer, window: Size) {
    let source = Harness::new();
    let mut ui = fit_ui(&source);
    dispatch(&mut ui, &source, EqMessage::Select(1));
    let initial_gain = ui.model.borrow().focused().unwrap().gain_db;
    let cache = ParamCache::new(source.params.clone());
    let viewport = Rectangle::new(Point::ORIGIN, window);
    let mut tree = None;
    let mut start = None;
    let mut fixed_bounds = None;
    let gain_id = crate::params::BAND_BASE + 4;

    // Repeat a motion at the same physical position after a live value rebuild,
    // and add/remove sibling menus while retaining the active rotary's state.
    for (step, delta) in [0.0, 18.0, 18.0, 36.0, 36.0].into_iter().enumerate() {
        if step == 2 {
            dispatch(&mut ui, &source, EqMessage::Menu(Panel::BandActions));
        }
        if step == 3 {
            dispatch(&mut ui, &source, EqMessage::Menu(Panel::Midi));
        }
        let messages = {
            let mut content = ui.view_editor(&cache);
            let tree = tree.get_or_insert_with(|| Tree::new(&content));
            tree.diff(&content);
            let node =
                content
                    .as_widget_mut()
                    .layout(tree, renderer, &Limits::new(Size::ZERO, window));
            let mut bounds = ControlsBounds::default();
            content
                .as_widget_mut()
                .operate(tree, Layout::new(&node), renderer, &mut bounds);
            let hud = bounds
                .hud
                .expect("selected HUD must remain present during drag");
            let placed = hud;
            assert_eq!(placed.center_x(), window.width * 0.5);
            assert_eq!(
                placed.y + placed.height,
                window.height - chrome::BOTTOM_HEIGHT - 42.0
            );
            assert_eq!(
                *fixed_bounds.get_or_insert(placed),
                placed,
                "gain/frequency and menu updates cannot move the HUD"
            );
            let center = bounds.gain.expect("gain rotary bounds").center();
            let origin = *start.get_or_insert(center);
            let pointer = Point::new(origin.x, origin.y - delta);
            let event = Event::Mouse(match step {
                0 => mouse::Event::ButtonPressed(mouse::Button::Left),
                4 => mouse::Event::ButtonReleased(mouse::Button::Left),
                _ => mouse::Event::CursorMoved { position: pointer },
            });
            let mut messages = Vec::new();
            let mut shell = Shell::new(&mut messages);
            if let Some(mut overlay) = content.as_widget_mut().overlay(
                tree,
                Layout::new(&node),
                renderer,
                &viewport,
                Vector::ZERO,
            ) {
                let overlay_node = overlay.as_overlay_mut().layout(renderer, window);
                overlay.as_overlay_mut().update(
                    &event,
                    Layout::new(&overlay_node),
                    mouse::Cursor::Available(pointer),
                    renderer,
                    &mut core::clipboard::Null,
                    &mut shell,
                );
            }
            if !shell.is_event_captured() {
                content.as_widget_mut().update(
                    tree,
                    &event,
                    Layout::new(&node),
                    mouse::Cursor::Available(pointer),
                    renderer,
                    &mut core::clipboard::Null,
                    &mut shell,
                    &viewport,
                );
            }
            messages
        };
        assert_eq!(messages.len(), 1, "one rotary intent per physical event");
        for message in messages {
            let Message::Plugin(message) = message else {
                panic!("unexpected widget intent")
            };
            dispatch(&mut ui, &source, message);
        }
        let expected_gain = initial_gain + f64::from(delta) / 3.0;
        assert!(
            (ui.model.borrow().focused().unwrap().gain_db - expected_gain).abs() < 1e-7,
            "stationary pointer must not accumulate gain"
        );
        if step < 4 {
            assert!(ui.model.borrow().has_gesture());
        }
    }
    assert!(!ui.model.borrow().has_gesture());
    assert!(ui.edited.is_empty());
    let events = source.events.lock().unwrap();
    for kind in ['b', 'e'] {
        assert_eq!(
            events
                .iter()
                .filter(|(event, id)| *event == kind && *id == gain_id)
                .count(),
            1,
            "one balanced host gesture"
        );
    }
    assert_eq!(
        events
            .iter()
            .filter(|(event, id)| *event == 's' && *id == gain_id)
            .count(),
        2,
        "repeated pointer position cannot send another gain write"
    );
}

/// Match the native runtime's update -> draw -> dispatch order. Captured graph
/// events clear Iced's overlay cache in this same frame, before message dispatch.
/// The HUD must therefore be present in the actual base draw, not just the tree.
fn verify_node_frames(renderer: &mut Renderer, window: Size) {
    use core::Renderer as _;
    use iced_runtime::user_interface::{Cache, UserInterface};

    let source = Harness::settlement(false);
    let mut ui = fit_ui(&source);
    dispatch(&mut ui, &source, EqMessage::Select(1));
    let initial = *ui.model.borrow().focused().unwrap();
    let params = ParamCache::new(source.params.clone());
    let viewport = Rectangle::new(Point::ORIGIN, window);
    let graph = Rectangle::new(
        Point::new(0.0, chrome::TOP_HEIGHT),
        Size::new(
            window.width,
            window.height - chrome::TOP_HEIGHT - chrome::BOTTOM_HEIGHT,
        ),
    );
    let plot = geometry::Plot::new(graph.size(), 12.0);
    let start = plot.visible_node(initial.frequency_hz as f32, initial.gain_db as f32)
        + Vector::new(graph.x, graph.y);
    let first_pointer = Point::new(start.x + 25.0, start.y - 18.0);
    let latest_pointer = Point::new(start.x + 50.0, start.y - 36.0);
    let mut cache = Cache::new();
    let mut fixed_bounds = None;
    let mut older = Vec::new();
    let mut latest = Vec::new();
    let mut expected_frequency = initial.frequency_hz;
    let mut expected_gain = initial.gain_db;
    let style = core::renderer::Style {
        text_color: style::palette().text,
    };

    for step in 0..=9 {
        if step == 3 {
            for &(id, value) in &older {
                source.params.set_normalized(id, value);
            }
        }
        if step == 9 {
            for &(id, value) in &latest {
                source.params.set_normalized(id, value);
            }
        }
        if step == 4 {
            ui.notify("Play audio before matching the sidechain.", true);
        }
        let before_config = ui.model.borrow().config.clone();
        let before_expected = ui.expected.borrow().clone();
        let before_host_events = source.events.lock().unwrap().clone();
        let before_edits = ui.edited.clone();
        let pointer = match step {
            0 => start,
            1 => first_pointer,
            2..=4 => latest_pointer,
            _ => {
                let hud: Rectangle = fixed_bounds.expect("earlier real HUD layout");
                Point::new(hud.x + 8.0, hud.y + 72.0)
            }
        };
        let mut events = match step {
            0 => vec![Event::Mouse(mouse::Event::ButtonPressed(
                mouse::Button::Left,
            ))],
            1 | 2 | 5 | 6 => vec![Event::Mouse(mouse::Event::CursorMoved {
                position: pointer,
            })],
            4 => vec![escape_event()],
            7 => vec![Event::Mouse(mouse::Event::ButtonReleased(
                mouse::Button::Left,
            ))],
            _ => Vec::new(),
        };
        events.push(Event::Window(
            truce_iced::iced::window::Event::RedrawRequested(std::time::Instant::now()),
        ));
        let mut messages = Vec::new();
        let (painted, hud) = {
            let mut frame = UserInterface::build(ui.view_editor(&params), window, cache, renderer);
            let mut bounds = ControlsBounds::default();
            frame.operate(renderer, &mut bounds);
            let hud = bounds
                .hud
                .expect("selected controls cannot disappear during node drag or stale settlement");
            assert_eq!(hud.center_x(), window.width * 0.5);
            assert_eq!(
                hud.y + hud.height,
                window.height - chrome::BOTTOM_HEIGHT - 42.0
            );
            assert_eq!(
                *fixed_bounds.get_or_insert(hud),
                hud,
                "selected controls remain anchored on every node frame"
            );
            let (_, statuses) = frame.update(
                &events,
                mouse::Cursor::Available(pointer),
                renderer,
                &mut core::clipboard::Null,
                &mut messages,
            );
            if matches!(step, 0 | 1 | 2 | 4 | 5 | 6 | 7) {
                assert_eq!(
                    statuses[0],
                    truce_iced::iced::event::Status::Captured,
                    "real graph pointer event must reach the node canvas"
                );
            }
            knobs::reset_paint_trace();
            frame.draw(
                renderer,
                &ui.theme(),
                &style,
                mouse::Cursor::Available(pointer),
            );
            let painted = knobs::painted_controls();
            assert_eq!(
                painted, 7,
                "Frequency/Gain/Q must actually paint on node input frame {step}; a layout-only HUD check misses this regression"
            );
            cache = frame.into_cache();
            (painted, hud)
        };
        let expected_messages = usize::from(matches!(step, 0 | 1 | 2 | 4 | 5 | 6 | 7));
        assert_eq!(
            messages.len(),
            expected_messages,
            "redraw and stale parameter frames must not publish deselection or extra gestures"
        );
        for message in messages {
            if step == 4 {
                assert!(matches!(message, Message::Plugin(EqMessage::DismissNotice)));
                dispatch(&mut ui, &source, EqMessage::DismissNotice);
                continue;
            }
            let Message::Plugin(EqMessage::GraphAt(revision, intent)) = message else {
                panic!("unexpected graph frame intent")
            };
            assert!(matches!(
                (&intent, step),
                (GraphMessage::BeginDrag { .. }, 0)
                    | (GraphMessage::Drag { .. }, 1 | 2 | 5 | 6)
                    | (GraphMessage::End, 7)
            ));
            dispatch(&mut ui, &source, EqMessage::GraphAt(revision, intent));
        }
        if step == 1 {
            older = ui.expected.borrow().clone();
        }
        if step == 2 || step == 5 {
            latest = ui.expected.borrow().clone();
        }
        if matches!(step, 1 | 2 | 5 | 6) {
            let local = pointer - graph.position();
            let start_local = start - graph.position();
            expected_frequency = initial.frequency_hz
                * f64::from(plot.x_frequency(local.x) / plot.x_frequency(start_local.x));
            expected_gain =
                initial.gain_db + f64::from(plot.y_gain(local.y) - plot.y_gain(start_local.y));
        }
        let focused = *ui
            .model
            .borrow()
            .focused()
            .expect("the dragged band stays selected");
        assert!((focused.frequency_hz - expected_frequency).abs() < 1e-4);
        assert!((focused.gain_db - expected_gain).abs() < 1e-5);
        assert_eq!(ui.model.borrow().has_gesture(), step < 7);
        if step == 4 {
            assert!(ui.notice.is_none());
            assert_eq!(ui.model.borrow().config, before_config);
            assert_eq!(*ui.expected.borrow(), before_expected);
            assert_eq!(*source.events.lock().unwrap(), before_host_events);
            assert_eq!(ui.edited, before_edits);
        }
        if step == 6 {
            assert_eq!(ui.model.borrow().config, before_config);
        }
        if step == 8 {
            assert!(
                !ui.expected.borrow().is_empty(),
                "older host values must not settle the latest intent"
            );
        }
        if step == 9 {
            assert!(
                ui.expected.borrow().is_empty(),
                "latest authoritative values settle without hiding the HUD"
            );
        }
        screenshot::record_node_drag_frame(
            window,
            step,
            hud,
            painted,
            focused.frequency_hz,
            focused.gain_db,
            ui.expected.borrow().len(),
        );
    }
    assert!(ui.edited.is_empty());
    let events = source.events.lock().unwrap();
    for id in [crate::params::BAND_BASE + 3, crate::params::BAND_BASE + 4] {
        for kind in ['b', 'e'] {
            assert_eq!(
                events
                    .iter()
                    .filter(|(event, target)| *event == kind && *target == id)
                    .count(),
                1,
                "one balanced host gesture per dragged frequency/gain"
            );
        }
    }
    // Leave the shared renderer empty before drawing the outer evidence scene.
    renderer.reset(viewport);
}

fn escape_event() -> Event {
    Event::Keyboard(keyboard::Event::KeyPressed {
        key: keyboard::Key::Named(keyboard::key::Named::Escape),
        modified_key: keyboard::Key::Named(keyboard::key::Named::Escape),
        physical_key: keyboard::key::Physical::Code(keyboard::key::Code::Escape),
        location: keyboard::Location::Standard,
        modifiers: keyboard::Modifiers::empty(),
        text: None,
        repeat: false,
    })
}

#[test]
fn host_undo_and_redo_shortcuts_leave_plugin_parameters_and_gestures_untouched() {
    let source = Harness::new();
    let mut ui = fit_ui(&source);
    dispatch(&mut ui, &source, EqMessage::Select(1));
    let before = ui.model.borrow().config.clone();
    for (character, modifiers) in [
        ("z", keyboard::Modifiers::CTRL),
        ("z", keyboard::Modifiers::CTRL | keyboard::Modifiers::SHIFT),
        ("y", keyboard::Modifiers::CTRL),
    ] {
        let event = keyboard::Event::KeyPressed {
            key: keyboard::Key::Character(character.into()),
            modified_key: keyboard::Key::Character(character.into()),
            physical_key: keyboard::key::Physical::Code(keyboard::key::Code::KeyZ),
            location: keyboard::Location::Standard,
            modifiers,
            text: None,
            repeat: false,
        };
        assert!(
            !update_ui::handles_key(&event),
            "host history shortcuts must not enter the editor subscription"
        );
        dispatch(&mut ui, &source, EqMessage::Key(event));
    }
    assert_eq!(ui.model.borrow().config, before);
    assert!(!ui.model.borrow().has_gesture());
    assert!(source.events.lock().unwrap().is_empty());
}
