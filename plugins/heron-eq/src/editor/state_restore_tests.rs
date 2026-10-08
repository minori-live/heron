//! Host Undo/preset recall wins over in-flight and queued native gestures.
use super::*;
use knobs::KnobMessage;
use truce::core::state::{DeserializedState, apply_params};

fn restore(source: &mut Harness, config: &heron_dsp_core::eq::EqConfig) {
    let recalled = EqParams::default();
    for (id, value) in recalled.normalized_values(config) {
        recalled.set_normalized(id, value);
    }
    // A host snapshot also carries automation targets for absent slots. No-op
    // pointer input must leave these values alone after the recall.
    let dormant = crate::params::BAND_BASE + 3 * crate::params::BAND_STRIDE + 3;
    recalled.set_plain(dormant, 7500.0);
    let (ids, values) = recalled.collect_values();
    // This is the VST3 host-state callback's real ordering. DelayedEditor has
    // no state_changed implementation, like the current upstream IcedEditor.
    apply_params(
        &*source.params,
        &DeserializedState {
            params: ids.into_iter().zip(values).collect(),
            extra: None,
            persist: Vec::new(),
        },
    );
    source.editor.state_changed();
}

#[test]
fn host_restore_discards_active_drag_and_pending_values_without_rolling_back_or_late_writes() {
    for rotary in [false, true] {
        let mut source = Harness::settlement(false);
        let mut ui = fit_ui(&source);
        dispatch(&mut ui, &source, EqMessage::Select(1));
        let initial = ui.model.borrow().config.clone();
        let original_gain = initial.bands[0].gain_db;
        let revision = source.params.telemetry.state_restore_revision();
        if rotary {
            dispatch(
                &mut ui,
                &source,
                EqMessage::KnobAt(revision, KnobMessage::Begin(Number::Gain)),
            );
            dispatch(
                &mut ui,
                &source,
                EqMessage::KnobAt(
                    revision,
                    KnobMessage::Change(Number::Gain, original_gain + 4.0),
                ),
            );
        } else {
            dispatch(
                &mut ui,
                &source,
                EqMessage::GraphAt(
                    revision,
                    GraphMessage::BeginDrag {
                        id: 1,
                        additive: false,
                        solo: true,
                    },
                ),
            );
            dispatch(
                &mut ui,
                &source,
                EqMessage::GraphAt(
                    revision,
                    GraphMessage::Drag {
                        frequency_ratio: 2.0,
                        gain_delta: 4.0,
                    },
                ),
            );
        }
        assert!(ui.model.borrow().has_gesture());
        assert!(!ui.expected.borrow().is_empty());
        assert!(!ui.edited.is_empty());
        assert!(
            !ui.needs_redraw(),
            "no audio/preview update before the recall marker"
        );

        let mut recalled = initial;
        recalled.bands[0].frequency_hz = 800.0;
        recalled.bands[0].gain_db = -5.0;
        recalled.output_gain_db = -2.0;
        restore(&mut source, &recalled);
        // End automation and audition synchronously, even without another mouse
        // event or audio block. The restore marker itself must wake the renderer.
        assert_eq!(source.params.telemetry.solo(), None);
        assert!(ui.needs_redraw());
        let host_after_restore = source.events.lock().unwrap().clone();
        let gain_id = crate::params::BAND_BASE + 4;
        assert_eq!(
            host_after_restore
                .iter()
                .filter(|event| **event == ('e', gain_id))
                .count(),
            1
        );

        // A paused-audio repaint adopts the host state before any UI message.
        let cache = ParamCache::new(source.params.clone());
        drop(ui.view_editor(&cache));
        assert_eq!(ui.model.borrow().config, source.params.snapshot());
        assert!(!ui.model.borrow().has_gesture());
        assert!(ui.expected.borrow().is_empty());
        let restored_values = source.params.collect_values();

        for message in [
            EqMessage::GraphAt(
                revision,
                GraphMessage::BeginDrag {
                    id: 1,
                    additive: false,
                    solo: false,
                },
            ),
            EqMessage::GraphAt(
                revision,
                GraphMessage::Drag {
                    frequency_ratio: 3.0,
                    gain_delta: 10.0,
                },
            ),
            EqMessage::KnobAt(revision, KnobMessage::Begin(Number::Gain)),
            EqMessage::KnobAt(revision, KnobMessage::Change(Number::Gain, 10.0)),
            EqMessage::Graph(GraphMessage::Drag {
                frequency_ratio: 3.0,
                gain_delta: 10.0,
            }),
            EqMessage::Knob(KnobMessage::Change(Number::Gain, 10.0)),
            EqMessage::Graph(GraphMessage::End),
            EqMessage::Knob(KnobMessage::End),
            EqMessage::Cancel,
        ] {
            dispatch(&mut ui, &source, message);
            assert_eq!(ui.model.borrow().config, source.params.snapshot());
            assert_eq!(source.params.collect_values(), restored_values);
        }
        assert_eq!(
            *source.events.lock().unwrap(),
            host_after_restore,
            "late input cannot reopen automation or write pre-restore intent"
        );
        assert!(ui.edited.is_empty());
        assert!(!ui.model.borrow().has_gesture());

        // Fresh input gets a fresh snapshot and can edit the recalled values.
        let revision = source.params.telemetry.state_restore_revision();
        dispatch(
            &mut ui,
            &source,
            EqMessage::KnobAt(revision, KnobMessage::Begin(Number::Gain)),
        );
        dispatch(
            &mut ui,
            &source,
            EqMessage::KnobAt(revision, KnobMessage::Change(Number::Gain, -4.0)),
        );
        dispatch(
            &mut ui,
            &source,
            EqMessage::KnobAt(revision, KnobMessage::End),
        );
        assert!((ui.model.borrow().config.bands[0].gain_db + 4.0).abs() < 1e-8);
    }
}

fn graph(ui: &EqUi) -> graph::Graph {
    let model = ui.model.borrow();
    graph::Graph {
        restore_revision: ui.last_restore_revision.get(),
        config: model.config.clone(),
        response_config: model.config.clone(),
        show_total_response: true,
        output_pan_matrix: [[1.0, 0.0], [0.0, 1.0]],
        prepared: None,
        selected: model.selected.clone(),
        spectrum: SpectrumSnapshot::default(),
        pre: true,
        post: true,
        external: false,
        range_db: 12.0,
        floor_db: -120.0,
        snap: false,
        font: truce_iced::iced::Font::DEFAULT,
        channel: EqChannel::Stereo,
        collisions: Vec::new(),
    }
}

#[test]
fn shift_node_drag_preserves_the_selected_group_and_gain_while_shift_click_toggles_only_that_node()
{
    use truce_iced::iced::{Point, Rectangle, Size, mouse, widget::canvas::Program};
    let source = Harness::new();
    let mut ui = fit_ui(&source);
    dispatch(
        &mut ui,
        &source,
        EqMessage::Graph(GraphMessage::SelectArea {
            ids: vec![1, 2],
            additive: false,
        }),
    );
    let original = ui.model.borrow().config.clone();
    let bounds = Rectangle::new(Point::ORIGIN, Size::new(1000.0, 600.0));
    let plot = geometry::Plot::new(bounds.size(), 12.0);
    let start = plot.visible_node(
        original.bands[0].frequency_hz as f32,
        original.bands[0].gain_db as f32,
    );
    let mut state = graph::GraphState::default();
    for (event, pointer) in [
        (
            Event::Keyboard(keyboard::Event::ModifiersChanged(
                keyboard::Modifiers::SHIFT,
            )),
            start,
        ),
        (
            Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)),
            start,
        ),
        (
            Event::Mouse(mouse::Event::CursorMoved {
                position: Point::new(start.x + 8.0, start.y - 10.0),
            }),
            Point::new(start.x + 8.0, start.y - 10.0),
        ),
        (
            Event::Mouse(mouse::Event::CursorMoved {
                position: Point::new(start.x + 80.0, start.y - 40.0),
            }),
            Point::new(start.x + 80.0, start.y - 40.0),
        ),
        (
            Event::Mouse(mouse::Event::ButtonReleased(mouse::Button::Left)),
            Point::new(start.x + 80.0, start.y - 40.0),
        ),
    ] {
        let message = graph(&ui)
            .update(
                &mut state,
                &event,
                bounds,
                mouse::Cursor::Available(pointer),
            )
            .and_then(|action| action.into_inner().0);
        if let Some(Message::Plugin(message)) = message {
            dispatch(&mut ui, &source, message);
        }
    }
    let model = ui.model.borrow();
    assert_eq!(model.selected, BTreeSet::from([1, 2]));
    let ratio = model.config.bands[0].frequency_hz / original.bands[0].frequency_hz;
    assert!(ratio > 1.0);
    assert!(
        (model.config.bands[1].frequency_hz / original.bands[1].frequency_hz - ratio).abs() < 1e-7
    );
    assert_eq!(model.config.bands[0].gain_db, original.bands[0].gain_db);
    assert_eq!(model.config.bands[1].gain_db, original.bands[1].gain_db);
    let clicked = plot.visible_node(
        model.config.bands[0].frequency_hz as f32,
        model.config.bands[0].gain_db as f32,
    );
    drop(model);
    let before = ui.model.borrow().config.clone();
    let events = source.events.lock().unwrap().clone();
    for event in [
        mouse::Event::ButtonPressed(mouse::Button::Left),
        mouse::Event::ButtonReleased(mouse::Button::Left),
    ] {
        if let Some(Message::Plugin(message)) = graph(&ui)
            .update(
                &mut state,
                &Event::Mouse(event),
                bounds,
                mouse::Cursor::Available(clicked),
            )
            .and_then(|action| action.into_inner().0)
        {
            dispatch(&mut ui, &source, message);
        }
    }
    assert_eq!(ui.model.borrow().selected, BTreeSet::from([2]));
    let before_values = source.params.normalized_values(&before);
    let after_values = source.params.normalized_values(&ui.model.borrow().config);
    for ((before_id, before), (after_id, after)) in before_values.into_iter().zip(after_values) {
        assert_eq!(before_id, after_id);
        assert!(
            (before - after).abs() < 1e-12,
            "Shift-click cannot change parameter intent"
        );
    }
    assert_eq!(*source.events.lock().unwrap(), events);
}

#[test]
fn restore_repaint_discards_old_numeric_draft_and_handles_removed_selection() {
    let mut source = Harness::new();
    let mut ui = fit_ui(&source);
    dispatch(&mut ui, &source, EqMessage::Select(1));
    dispatch(
        &mut ui,
        &source,
        EqMessage::Knob(KnobMessage::Edit(Number::Gain)),
    );
    dispatch(
        &mut ui,
        &source,
        EqMessage::Draft(Number::Gain, "28".into()),
    );
    let mut config = ui.model.borrow().config.clone();
    config.bands.retain(|band| band.id != 1);
    restore(&mut source, &config);
    let cache = ParamCache::new(source.params.clone());
    drop(ui.view_editor(&cache));
    assert!(ui.model.borrow().focused().is_none());
    assert!(ui.numeric_for_view().is_none());
    assert!(ui.draft_for_view(Number::Gain).is_none());
    let events = source.events.lock().unwrap().clone();
    dispatch(&mut ui, &source, EqMessage::Submit(Number::Gain));
    assert_eq!(ui.model.borrow().config, source.params.snapshot());
    assert_eq!(*source.events.lock().unwrap(), events);
}
