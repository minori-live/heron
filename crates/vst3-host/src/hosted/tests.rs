use super::*;

#[test]
fn empty_midi_mapping_and_out_of_range_queries_are_unmapped() {
    let mapping = MidiMappingTable::query(None).unwrap();

    assert_eq!(mapping.parameter(0, 0), None);
    assert_eq!(mapping.parameter(15, MIDI_PROGRAM_CHANGE), None);
    assert_eq!(mapping.parameter(16, 0), None);
    assert_eq!(mapping.parameter(0, MIDI_MAPPING_CONTROLLERS), None);
}

#[test]
fn midi_mapping_returns_only_assigned_parameters() {
    let mapping = MidiMappingTable::query(None).unwrap();
    mapping.parameters[MIDI_MAPPING_CONTROLLERS + MIDI_PITCH_BEND].store(77, Ordering::Release);

    assert_eq!(mapping.parameter(1, MIDI_PITCH_BEND), Some(77));
    assert_eq!(mapping.parameter(1, MIDI_AFTERTOUCH), None);
}

#[test]
fn utf16_string_stops_at_nul_and_replaces_invalid_sequences() {
    assert_eq!(
        utf16_string(&[b'A' as u16, b'B' as u16, 0, b'C' as u16]),
        "AB"
    );
    assert_eq!(utf16_string(&[0xd800, 0]), "�");
    assert_eq!(utf16_string(&[]), "");
}

#[test]
fn vst3_result_mapping_preserves_operation_and_result_code() {
    assert!(crate::results::require_success("activate", 0).is_ok());
    assert!(matches!(
        crate::results::require_success("activate", -7),
        Err(HostError::Operation {
            operation: "activate",
            result: -7,
        })
    ));
}

#[test]
fn controller_parameter_sync_accepts_ok_and_declined_gui_updates() {
    assert!(
        crate::results::controller_sync_result("IEditController::setParamNormalized", 0).is_ok()
    );
    assert!(
        crate::results::controller_sync_result("IEditController::setParamNormalized", 1).is_ok()
    );
}

#[test]
fn controller_parameter_sync_preserves_actual_failures() {
    assert!(matches!(
        crate::results::controller_sync_result("IEditController::setParamNormalized", -7),
        Err(HostError::Operation {
            operation: "IEditController::setParamNormalized",
            result: -7,
        })
    ));
    assert!(
        crate::results::controller_sync_result("IEditController::setParamNormalized", 3).is_ok()
    );
}

#[test]
fn controller_parameter_edit_requires_a_known_writable_parameter() {
    assert!(validate_controller_parameter_edit(Some(0)).is_ok());
    assert!(matches!(
        validate_controller_parameter_edit(None),
        Err(HostError::InvalidArgument { .. })
    ));
    assert!(
        validate_controller_parameter_edit(Some(as_uint32(
            Vst::ParameterInfo_ParameterFlags_kIsReadOnly
        )))
        .is_err()
    );
    assert!(
        validate_controller_parameter_edit(Some(as_uint32(
            Vst::ParameterInfo_ParameterFlags_kIsHidden
        )))
        .is_err()
    );
}

#[test]
fn recognizes_every_sdk_not_implemented_encoding() {
    for result in [3, 0x8000_4001_u32 as i32, 0x8000_0001_u32 as i32] {
        assert!(
            (crate::results::ResultCode::decode(result)
                == crate::results::ResultCode::NotImplemented)
        );
    }
    assert!(!(crate::results::ResultCode::decode(0) == crate::results::ResultCode::NotImplemented));
    assert!(!(crate::results::ResultCode::decode(1) == crate::results::ResultCode::NotImplemented));
}

#[test]
fn controller_state_sync_decline_is_independent_of_component_restore() {
    use crate::results::{ControllerSync, controller_sync_result};
    assert_eq!(
        controller_sync_result("IEditController::setComponentState", 1).unwrap(),
        ControllerSync::Declined
    );
    assert!(crate::results::require_success("IComponent::setState", 1).is_err());
}
