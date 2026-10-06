use std::{ffi::OsString, path::PathBuf};

use heron_vst3_host::ClassId;

pub(super) struct ProbeArguments {
    pub(super) path: PathBuf,
    pub(super) soft: bool,
    pub(super) plugin_id: Option<ClassId>,
}

impl ProbeArguments {
    pub(super) fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Self, &'static str> {
        let mut args = args.into_iter();
        let mut path = None;
        let mut soft = false;
        let mut plugin_id = None;
        let mut options = true;
        while let Some(arg) = args.next() {
            if options && arg == "--" {
                options = false;
            } else if options && arg == "--soft" {
                soft = true;
            } else if options && arg == "--plugin-id" {
                if plugin_id.is_some() {
                    return Err("--plugin-id may only be supplied once");
                }
                let id = args
                    .next()
                    .ok_or("--plugin-id requires a VST3 class ID")?
                    .into_string()
                    .map_err(|_| "VST3 class ID must be valid UTF-8")?;
                plugin_id = Some(id.parse().map_err(|_| "invalid VST3 class ID")?);
            } else if options && arg.to_str().is_some_and(|value| value.starts_with('-')) {
                return Err("unknown VST3 probe option");
            } else if arg.is_empty() || path.replace(PathBuf::from(arg)).is_some() {
                return Err("exactly one VST3 module path is required");
            }
        }
        Ok(Self {
            path: path
                .ok_or("usage: heron-vst3-probe [--soft] [--plugin-id <class-id>] <module.vst3>")?,
            soft,
            plugin_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "01010101010101010101010101010101";

    fn parse(args: &[&str]) -> Result<ProbeArguments, &'static str> {
        ProbeArguments::parse(args.iter().map(OsString::from))
    }

    #[test]
    fn plugin_selector_does_not_become_the_module_path() {
        for args in [
            vec!["--plugin-id", ID, "--soft", "Shell.vst3"],
            vec!["Shell.vst3", "--plugin-id", ID, "--soft"],
        ] {
            let request = parse(&args).unwrap();
            assert_eq!(request.path, PathBuf::from("Shell.vst3"));
            assert_eq!(request.plugin_id, Some(ClassId::from_bytes([1; 16])));
            assert!(request.soft);
        }
        let full = parse(&["Shell.vst3"]).unwrap();
        assert_eq!(full.plugin_id, None);
        assert!(!full.soft);
    }

    #[test]
    fn malformed_probe_arguments_are_rejected_before_module_loading() {
        for args in [
            vec![],
            vec!["--plugin-id", ID],
            vec!["Shell.vst3", "--plugin-id"],
            vec!["Shell.vst3", "--plugin-id", ""],
            vec!["Shell.vst3", "--plugin-id", "not-a-class-id"],
            vec!["Shell.vst3", "--plugin-id", ID, "--plugin-id", ID],
            vec!["Shell.vst3", "other.vst3"],
            vec!["--unknown", "Shell.vst3"],
        ] {
            assert!(parse(&args).is_err(), "accepted invalid args: {args:?}");
        }
    }
}
