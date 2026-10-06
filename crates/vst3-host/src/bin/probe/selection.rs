use super::{AraOutput, ClassId, ClassInfo};

pub(super) fn inspect_classes<T>(
    discovered: Vec<ClassInfo>,
    plugin_id: Option<ClassId>,
    mut inspect_ara: impl FnMut(&ClassInfo) -> Option<AraOutput>,
    mut inspect_audio: impl FnMut(ClassInfo, Option<AraOutput>) -> T,
) -> Result<Vec<T>, &'static str> {
    let (audio, other): (Vec<_>, Vec<_>) = discovered
        .into_iter()
        .partition(|class| class.category == "Audio Module Class");
    let audio = audio
        .into_iter()
        .filter(|class| plugin_id.is_none_or(|id| class.id == id))
        .collect::<Vec<_>>();
    if plugin_id.is_some() && audio.is_empty() {
        return Err("requested VST3 plug-in ID is not exported by this module");
    }
    // A shell may export hundreds of unrelated processors and ARA factories.
    // Select metadata first, before invoking any class-specific native code.
    let ara_factories = other
        .iter()
        .filter(|class| class.category == "ARA Main Factory Class")
        .filter(|class| plugin_id.is_none() || audio.iter().any(|audio| audio.name == class.name))
        .filter_map(|class| inspect_ara(class).map(|ara| (class.name.clone(), ara)))
        .collect::<std::collections::HashMap<_, _>>();
    Ok(audio
        .into_iter()
        .map(|class| {
            let ara = ara_factories.get(&class.name).cloned();
            inspect_audio(class, ara)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn class(id: u8, name: &str, category: &str) -> ClassInfo {
        ClassInfo {
            id: ClassId::from_bytes([id; 16]),
            name: name.to_owned(),
            category: category.to_owned(),
            subcategories: "Fx|EQ".to_owned(),
            vendor: "Fixture".to_owned(),
            version: "1".to_owned(),
        }
    }

    fn discovered() -> Vec<ClassInfo> {
        vec![
            class(1, "Selected Mono", "Audio Module Class"),
            class(2, "Unrelated Stereo", "Audio Module Class"),
            class(3, "Selected Mono", "ARA Main Factory Class"),
            class(4, "Unrelated Stereo", "ARA Main Factory Class"),
        ]
    }

    #[test]
    fn requested_class_limits_audio_and_ara_inspection() {
        let mut ara_inspected = Vec::new();
        let inspected = inspect_classes(
            discovered(),
            Some(ClassId::from_bytes([1; 16])),
            |class| {
                ara_inspected.push(class.id);
                None
            },
            |class, _| class.id,
        )
        .unwrap();
        assert_eq!(inspected, vec![ClassId::from_bytes([1; 16])]);
        assert_eq!(ara_inspected, vec![ClassId::from_bytes([3; 16])]);
    }

    #[test]
    fn unknown_class_fails_before_any_plugin_or_ara_inspection() {
        assert!(
            inspect_classes(
                discovered(),
                Some(ClassId::from_bytes([99; 16])),
                |_| panic!("unknown ID must not inspect any ARA factory"),
                |_, _| panic!("unknown ID must not inspect any audio class"),
            )
            .is_err()
        );
    }

    #[test]
    fn full_catalog_keeps_all_audio_and_ara_classes() {
        let mut ara_inspected = Vec::new();
        let inspected = inspect_classes(
            discovered(),
            None,
            |class| {
                ara_inspected.push(class.id);
                None
            },
            |class, _| class.id,
        )
        .unwrap();
        assert_eq!(
            inspected,
            vec![ClassId::from_bytes([1; 16]), ClassId::from_bytes([2; 16])]
        );
        assert_eq!(
            ara_inspected,
            vec![ClassId::from_bytes([3; 16]), ClassId::from_bytes([4; 16])]
        );
    }
}
