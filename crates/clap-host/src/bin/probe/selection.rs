use heron_clap_host::ClapDescriptor;

pub(super) fn inspect_descriptors<T>(
    mut descriptors: Vec<ClapDescriptor>,
    plugin_id: Option<&str>,
    inspect: impl FnMut(ClapDescriptor) -> T,
) -> Result<Vec<T>, &'static str> {
    if let Some(plugin_id) = plugin_id {
        descriptors.retain(|descriptor| descriptor.id == plugin_id);
        if descriptors.is_empty() {
            return Err("requested CLAP plug-in ID is not exported by this module");
        }
    }
    Ok(descriptors.into_iter().map(inspect).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor(id: &str) -> ClapDescriptor {
        ClapDescriptor {
            id: id.to_owned(),
            name: id.to_owned(),
            vendor: "Fixture".to_owned(),
            version: "1".to_owned(),
            description: String::new(),
            features: vec!["audio-effect".to_owned()],
        }
    }

    fn descriptors() -> Vec<ClapDescriptor> {
        vec![descriptor("selected.mono"), descriptor("unrelated.stereo")]
    }

    #[test]
    fn requested_plugin_limits_inspection() {
        let inspected =
            inspect_descriptors(descriptors(), Some("selected.mono"), |plugin| plugin.id).unwrap();
        assert_eq!(inspected, vec!["selected.mono"]);
    }

    #[test]
    fn unknown_plugin_fails_before_inspection() {
        assert!(
            inspect_descriptors(descriptors(), Some("missing"), |_| {
                panic!("unknown ID must not inspect any plugin")
            })
            .is_err()
        );
    }

    #[test]
    fn full_catalog_keeps_all_plugins() {
        let inspected = inspect_descriptors(descriptors(), None, |plugin| plugin.id).unwrap();
        assert_eq!(inspected, vec!["selected.mono", "unrelated.stereo"]);
    }
}
