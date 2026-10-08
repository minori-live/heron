//! Session revocation owns audio audition independently of parameter gestures.
use super::*;

#[test]
fn old_ui_drop_and_retired_session_cannot_clear_solo_from_reopened_editor() {
    let mut source = Harness::new();
    let old_session = source.session();
    let mut old_ui = fit_ui(&source);
    dispatch(&mut old_ui, &source, EqMessage::Select(1));
    dispatch(&mut old_ui, &source, EqMessage::Solo);
    assert_eq!(source.params.telemetry.solo(), Some(1));

    source.editor.close();
    assert_eq!(
        source.params.telemetry.solo(),
        None,
        "revoke must stop audition before delayed UI destruction"
    );
    let erased: Arc<dyn Params> = source.params.clone();
    source.editor.open(
        RawWindowHandle::Win32(std::ptr::null_mut()),
        PluginContext::new(host(source.params.clone(), source.events.clone()), erased),
    );
    let mut new_ui = fit_ui(&source);
    dispatch(&mut new_ui, &source, EqMessage::Select(2));
    dispatch(&mut new_ui, &source, EqMessage::Solo);
    assert_eq!(source.params.telemetry.solo(), Some(2));

    drop(old_ui);
    assert_eq!(source.params.telemetry.solo(), Some(2));
    old_session.publish_solo(Some(3));
    old_session.close();
    assert_eq!(source.params.telemetry.solo(), Some(2));
    source.editor.close();
    assert_eq!(source.params.telemetry.solo(), None);
}

#[test]
fn closing_the_editor_stops_audition_before_any_parameter_delta() {
    let mut source = Harness::new();
    let mut ui = fit_ui(&source);
    dispatch(
        &mut ui,
        &source,
        EqMessage::Graph(GraphMessage::BeginDrag {
            id: 1,
            additive: false,
            solo: true,
        }),
    );
    assert_eq!(source.params.telemetry.solo(), Some(1));
    assert!(
        ui.edited.is_empty(),
        "audition may precede parameter movement"
    );
    assert!(source.events.lock().unwrap().is_empty());
    source.editor.close();
    assert_eq!(source.params.telemetry.solo(), None);
    drop(ui);
    assert_eq!(source.params.telemetry.solo(), None);
}
