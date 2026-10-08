use super::*;
use heron_dsp_core::eq::EqBand;
use truce_iced::iced::{Size, widget::canvas::Program};

fn graph() -> Graph {
    let config = EqConfig {
        bands: vec![EqBand {
            id: 1,
            frequency_hz: 1000.0,
            gain_db: 3.0,
            ..EqBand::default()
        }],
        ..EqConfig::default()
    };
    Graph {
        restore_revision: 0,
        response_config: config.clone(),
        config,
        show_total_response: true,
        output_pan_matrix: [[1.0, 0.0], [0.0, 1.0]],
        prepared: None,
        selected: BTreeSet::from([1]),
        spectrum: SpectrumSnapshot::default(),
        pre: true,
        post: true,
        external: false,
        range_db: 12.0,
        floor_db: -120.0,
        snap: false,
        font: Font::DEFAULT,
        channel: EqChannel::Stereo,
        collisions: Vec::new(),
    }
}

fn bounds() -> Rectangle {
    Rectangle {
        x: 25.0,
        y: 70.0,
        width: 1000.0,
        height: 600.0,
    }
}
fn plot() -> Plot {
    Plot::new(Size::new(bounds().width, bounds().height), 12.0)
}
fn node() -> Point {
    plot().visible_node(1000.0, 3.0)
}
fn blank() -> Point {
    plot().node(100.0, -8.0)
}

fn send(graph: &Graph, state: &mut GraphState, event: Event, point: Point) -> Option<GraphMessage> {
    let cursor = mouse::Cursor::Available(Point::new(point.x + bounds().x, point.y + bounds().y));
    match graph
        .update(state, &event, bounds(), cursor)
        .and_then(|action| action.into_inner().0)
    {
        Some(Message::Plugin(EqMessage::GraphAt(_, message))) => Some(message),
        None => None,
        _ => panic!("canvas published an unrelated intent"),
    }
}

fn press(graph: &Graph, state: &mut GraphState, point: Point) -> Option<GraphMessage> {
    send(
        graph,
        state,
        Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)),
        point,
    )
}
fn release(graph: &Graph, state: &mut GraphState, point: Point) -> Option<GraphMessage> {
    send(
        graph,
        state,
        Event::Mouse(mouse::Event::ButtonReleased(mouse::Button::Left)),
        point,
    )
}
fn motion(graph: &Graph, state: &mut GraphState, point: Point) -> Option<GraphMessage> {
    send(
        graph,
        state,
        Event::Mouse(mouse::Event::CursorMoved { position: point }),
        point,
    )
}
fn modifiers(graph: &Graph, state: &mut GraphState, modifiers: keyboard::Modifiers) {
    assert!(
        send(
            graph,
            state,
            Event::Keyboard(keyboard::Event::ModifiersChanged(modifiers)),
            blank()
        )
        .is_none()
    );
}

#[test]
fn obscuring_hud_blocks_new_graph_presses_but_preserves_an_owned_node_drag() {
    let graph = graph();
    let mut state = GraphState::default();
    let position = Point::new(node().x + bounds().x, node().y + bounds().y);
    assert!(
        graph
            .update(
                &mut state,
                &Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)),
                bounds(),
                mouse::Cursor::Levitating(position),
            )
            .is_none(),
        "the HUD must retain its own clicks"
    );
    assert!(matches!(
        press(&graph, &mut state, node()),
        Some(GraphMessage::BeginDrag { id: 1, .. })
    ));
    let target = Point::new(position.x + 80.0, position.y + 120.0);
    let action = graph
        .update(
            &mut state,
            &Event::Mouse(mouse::Event::CursorMoved { position: target }),
            bounds(),
            mouse::Cursor::Levitating(target),
        )
        .expect("an existing graph gesture keeps its physical pointer");
    assert!(matches!(
        action.into_inner().0,
        Some(Message::Plugin(EqMessage::GraphAt(
            _,
            GraphMessage::Drag { .. }
        )))
    ));
    let action = graph
        .update(
            &mut state,
            &Event::Mouse(mouse::Event::ButtonReleased(mouse::Button::Left)),
            bounds(),
            mouse::Cursor::Levitating(target),
        )
        .expect("release over the HUD must close the original graph gesture");
    assert!(matches!(
        action.into_inner().0,
        Some(Message::Plugin(EqMessage::GraphAt(_, GraphMessage::End)))
    ));
    assert!(state.drag.is_none());
}

#[test]
fn host_restore_invalidates_a_retained_node_pointer_before_late_motion_or_release() {
    let mut graph = graph();
    let mut state = GraphState::default();
    assert!(matches!(
        press(&graph, &mut state, node()),
        Some(GraphMessage::BeginDrag { .. })
    ));
    graph.restore_revision = 1;
    graph.config.bands[0].gain_db = -6.0;
    assert!(motion(&graph, &mut state, Point::new(node().x + 30.0, node().y)).is_none());
    assert!(release(&graph, &mut state, node()).is_none());
    let restored = plot().visible_node(1000.0, -6.0);
    assert!(matches!(
        press(&graph, &mut state, restored),
        Some(GraphMessage::BeginDrag { id: 1, .. })
    ));
}

#[test]
fn empty_click_deselects_without_box_selection_but_actual_shift_drag_preserves_additive_intent() {
    let graph = graph();
    let mut state = GraphState::default();
    assert!(press(&graph, &mut state, blank()).is_none());
    assert!(motion(&graph, &mut state, Point::new(blank().x + 2.0, blank().y)).is_none());
    assert!(matches!(
        release(&graph, &mut state, blank()),
        Some(GraphMessage::Deselect)
    ));

    modifiers(&graph, &mut state, keyboard::Modifiers::SHIFT);
    let start = Point::new(node().x - 30.0, node().y - 30.0);
    let end = Point::new(node().x + 30.0, node().y + 30.0);
    assert!(press(&graph, &mut state, start).is_none());
    modifiers(&graph, &mut state, keyboard::Modifiers::empty());
    assert!(motion(&graph, &mut state, end).is_none());
    match release(&graph, &mut state, end) {
        Some(GraphMessage::SelectArea { ids, additive }) => {
            assert_eq!(ids, vec![1]);
            assert!(additive);
        }
        other => panic!("expected real additive selection, got {other:?}"),
    }
}

#[test]
fn right_click_node_requests_context_at_window_position_without_deleting_or_starting_gesture() {
    let graph = graph();
    let mut state = GraphState::default();
    let message = send(
        &graph,
        &mut state,
        Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Right)),
        node(),
    );
    match message {
        Some(GraphMessage::ContextMenu { id, position }) => {
            assert_eq!(id, 1);
            assert_eq!(
                position,
                Point::new(node().x + bounds().x, node().y + bounds().y)
            );
        }
        other => panic!("expected context request, got {other:?}"),
    }
    assert!(release(&graph, &mut state, node()).is_none());
}

#[test]
fn alt_click_toggles_band_while_alt_drag_auditions_until_release_and_never_toggles() {
    let graph = graph();
    let mut state = GraphState::default();
    modifiers(&graph, &mut state, keyboard::Modifiers::ALT);
    let cursor = mouse::Cursor::Available(Point::new(node().x + bounds().x, node().y + bounds().y));
    assert_eq!(
        graph.mouse_interaction(&state, bounds(), cursor),
        mouse::Interaction::Pointer
    );
    assert!(press(&graph, &mut state, node()).is_none());
    assert!(motion(&graph, &mut state, Point::new(node().x + 2.0, node().y)).is_none());
    assert!(matches!(
        release(&graph, &mut state, node()),
        Some(GraphMessage::ToggleEnabled(1))
    ));

    assert!(press(&graph, &mut state, node()).is_none());
    assert!(matches!(
        motion(&graph, &mut state, Point::new(node().x + 5.0, node().y)),
        Some(GraphMessage::BeginDrag {
            id: 1,
            solo: true,
            ..
        })
    ));
    assert!(matches!(
        motion(&graph, &mut state, Point::new(node().x + 30.0, node().y)),
        Some(GraphMessage::Drag { .. })
    ));
    assert!(matches!(
        release(&graph, &mut state, node()),
        Some(GraphMessage::End)
    ));
    assert!(release(&graph, &mut state, node()).is_none());
}

#[test]
fn focus_loss_cancels_active_drag_and_escape_cancels_pending_alt_click_without_late_commit() {
    let graph = graph();
    let mut state = GraphState::default();
    assert!(matches!(
        press(&graph, &mut state, node()),
        Some(GraphMessage::BeginDrag { solo: false, .. })
    ));
    assert!(matches!(
        send(
            &graph,
            &mut state,
            Event::Window(truce_iced::iced::window::Event::Unfocused),
            node()
        ),
        Some(GraphMessage::Cancel)
    ));
    assert!(release(&graph, &mut state, node()).is_none());
    assert!(motion(&graph, &mut state, Point::new(node().x + 30.0, node().y)).is_none());

    modifiers(&graph, &mut state, keyboard::Modifiers::ALT);
    assert!(press(&graph, &mut state, node()).is_none());
    let escape = Event::Keyboard(keyboard::Event::KeyPressed {
        key: keyboard::Key::Named(keyboard::key::Named::Escape),
        modified_key: keyboard::Key::Named(keyboard::key::Named::Escape),
        physical_key: keyboard::key::Physical::Code(keyboard::key::Code::Escape),
        location: keyboard::Location::Standard,
        modifiers: keyboard::Modifiers::ALT,
        text: None,
        repeat: false,
    });
    assert!(matches!(
        send(&graph, &mut state, escape, node()),
        Some(GraphMessage::Cancel)
    ));
    assert!(release(&graph, &mut state, node()).is_none());
}

#[test]
fn double_click_blank_adds_band_and_hover_wheel_and_axis_locks_keep_their_intents() {
    let graph = graph();
    let mut state = GraphState::default();
    press(&graph, &mut state, blank());
    release(&graph, &mut state, blank());
    assert!(matches!(
        press(&graph, &mut state, blank()),
        Some(GraphMessage::Add { .. })
    ));
    assert!(release(&graph, &mut state, blank()).is_none());

    let cursor = mouse::Cursor::Available(Point::new(node().x + bounds().x, node().y + bounds().y));
    assert_eq!(
        graph.mouse_interaction(&state, bounds(), cursor),
        mouse::Interaction::Grab
    );
    assert!(matches!(
        send(
            &graph,
            &mut state,
            Event::Mouse(mouse::Event::WheelScrolled {
                delta: mouse::ScrollDelta::Lines { x: 0.0, y: 1.0 }
            }),
            node()
        ),
        Some(GraphMessage::Q { id: 1, delta: 1.0 })
    ));
    press(&graph, &mut state, node());
    modifiers(&graph, &mut state, keyboard::Modifiers::CTRL);
    assert!(
        matches!(motion(&graph, &mut state, Point::new(node().x + 20.0, node().y + 20.0)), Some(GraphMessage::Drag { frequency_ratio: 1.0, gain_delta }) if gain_delta < 0.0)
    );
    release(&graph, &mut state, node());
}
