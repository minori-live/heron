//! Failed matching and notice dismissal never commit or terminate another edit.
use super::*;
use heron_dsp_core::eq::EqConfig;

#[derive(Debug, PartialEq)]
struct EditState {
    config: EqConfig,
    extras: Extras,
    selected: BTreeSet<u32>,
    solo: Option<u32>,
    gesture: bool,
    expected: Vec<(u32, f64)>,
    edited: BTreeSet<u32>,
    drafts: BTreeMap<Number, String>,
    numeric_edit: Option<Number>,
    params: Vec<(u32, f64)>,
    audio_solo: Option<u32>,
    host_events: Vec<(char, u32)>,
}

fn state(ui: &EqUi, source: &Harness) -> EditState {
    let model = ui.model.borrow();
    let (ids, values) = source.params.collect_values();
    EditState {
        config: model.config.clone(),
        extras: model.extras,
        selected: model.selected.clone(),
        solo: model.solo,
        gesture: model.has_gesture(),
        expected: ui.expected.borrow().clone(),
        edited: ui.edited.clone(),
        drafts: ui.drafts.clone(),
        numeric_edit: ui.numeric_edit,
        params: ids.into_iter().zip(values).collect(),
        audio_solo: source.params.telemetry.solo(),
        host_events: source.events.lock().unwrap().clone(),
    }
}

fn selected_ui(source: &Harness) -> EqUi {
    let mut ui = fit_ui(source);
    dispatch(
        &mut ui,
        source,
        EqMessage::Graph(GraphMessage::SelectArea {
            ids: vec![1, 2],
            additive: false,
        }),
    );
    dispatch(&mut ui, source, EqMessage::PhaseInvert(true));
    dispatch(&mut ui, source, EqMessage::AutoGain(true));
    dispatch(&mut ui, source, EqMessage::Solo);
    ui
}

fn delayed_drag() -> (Harness, EqUi) {
    let source = Harness::settlement(false);
    let mut ui = fit_ui(&source);
    dispatch(&mut ui, &source, EqMessage::Select(1));
    let gain = ui.model.borrow().focused().unwrap().gain_db;
    dispatch(
        &mut ui,
        &source,
        EqMessage::Knob(knobs::KnobMessage::Begin(Number::Gain)),
    );
    dispatch(
        &mut ui,
        &source,
        EqMessage::Knob(knobs::KnobMessage::Change(Number::Gain, gain + 3.0)),
    );
    assert!(ui.model.borrow().has_gesture());
    assert!(!ui.expected.borrow().is_empty());
    assert!(!ui.edited.is_empty());
    (source, ui)
}

#[test]
fn silent_sidechain_match_preserves_settings_selection_and_host_values() {
    let source = Harness::new();
    let mut ui = selected_ui(&source);
    source.events.lock().unwrap().clear();
    let before = state(&ui, &source);
    dispatch(&mut ui, &source, EqMessage::Match);
    assert_eq!(state(&ui, &source), before);
    assert!(ui.notice.as_ref().is_some_and(|notice| notice.error));
}

#[test]
fn failed_match_does_not_resend_pending_values_or_end_delayed_host_edit() {
    let (source, mut ui) = delayed_drag();
    let before = state(&ui, &source);
    dispatch(&mut ui, &source, EqMessage::Match);
    assert_eq!(state(&ui, &source), before);
    assert!(ui.notice.as_ref().is_some_and(|notice| notice.error));
}

#[test]
fn dismiss_notice_clears_only_feedback_without_parameter_or_gesture_changes() {
    let (source, mut ui) = delayed_drag();
    ui.notify("Operation failed", true);
    let before = state(&ui, &source);
    dispatch(&mut ui, &source, EqMessage::DismissNotice);
    assert!(ui.notice.is_none());
    assert_eq!(state(&ui, &source), before);
}

#[test]
fn escape_dismisses_notice_before_canceling_an_active_gesture() {
    let (source, mut ui) = delayed_drag();
    ui.notify("Operation failed", true);
    let before = state(&ui, &source);
    dispatch(
        &mut ui,
        &source,
        EqMessage::Key(keyboard::Event::KeyPressed {
            key: keyboard::Key::Named(keyboard::key::Named::Escape),
            modified_key: keyboard::Key::Named(keyboard::key::Named::Escape),
            physical_key: keyboard::key::Physical::Code(keyboard::key::Code::Escape),
            location: keyboard::Location::Standard,
            modifiers: keyboard::Modifiers::empty(),
            text: None,
            repeat: false,
        }),
    );
    assert!(ui.notice.is_none());
    assert_eq!(state(&ui, &source), before);
}

#[test]
fn opening_another_menu_clears_old_notice_without_touching_active_edit() {
    let (source, mut ui) = delayed_drag();
    let before = state(&ui, &source);
    for panel in [Panel::Tools, Panel::Output, Panel::Analyzer] {
        ui.notify("Earlier matching failed", true);
        dispatch(&mut ui, &source, EqMessage::Menu(panel));
        assert!(ui.notice.is_none());
        assert_eq!(ui.panel, Some(panel));
        assert_eq!(state(&ui, &source), before);
    }
}

#[test]
fn current_sample_rate_rejection_keeps_successful_fit_candidate_uncommitted() {
    let source = Harness::new();
    let mut ui = selected_ui(&source);
    let broadband = SpectrumSnapshot {
        sample_rate: 48_000.0,
        frequency_hz: (0..128_u16)
            .map(|index| (20.0_f64 * 1000.0_f64.powf(f64::from(index) / 127.0)) as f32)
            .collect(),
        pre_db: vec![-24.0; 128],
        external_db: vec![-18.0; 128],
        ..Default::default()
    };
    let mut reference = broadband.clone();
    reference.post_db = reference.external_db.clone();
    assert!(matching::fit(&broadband, &reference).is_ok());
    ui.frozen = Some(broadband);
    ui.notify("Earlier operation succeeded", false);
    source.params.telemetry.set_sample_rate(0.0);
    source.events.lock().unwrap().clear();
    let before = state(&ui, &source);
    dispatch(&mut ui, &source, EqMessage::Match);
    assert_eq!(state(&ui, &source), before);
    assert!(
        ui.notice.as_ref().is_some_and(|notice| notice.error),
        "a rejected candidate must not produce success feedback"
    );
}
