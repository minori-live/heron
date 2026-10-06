use std::{ffi::OsString, path::PathBuf};

pub(super) struct ProbeArguments {
    pub(super) path: PathBuf,
    pub(super) soft: bool,
    pub(super) plugin_id: Option<String>,
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
                    .ok_or("--plugin-id requires a CLAP plug-in ID")?
                    .into_string()
                    .map_err(|_| "CLAP plug-in ID must be valid UTF-8")?;
                if id.is_empty() || id.starts_with('-') || id.contains('\0') {
                    return Err("invalid CLAP plug-in ID");
                }
                plugin_id = Some(id);
            } else if options && arg.to_str().is_some_and(|value| value.starts_with('-')) {
                return Err("unknown CLAP probe option");
            } else if arg.is_empty() || path.replace(PathBuf::from(arg)).is_some() {
                return Err("exactly one CLAP module path is required");
            }
        }
        Ok(Self {
            path: path
                .ok_or("usage: heron-clap-probe [--soft] [--plugin-id <id>] <module.clap>")?,
            soft,
            plugin_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<ProbeArguments, &'static str> {
        ProbeArguments::parse(args.iter().map(OsString::from))
    }

    #[test]
    fn plugin_selector_does_not_become_the_module_path() {
        for args in [
            vec!["--plugin-id", "selected.mono", "--soft", "Shell.clap"],
            vec!["Shell.clap", "--plugin-id", "selected.mono", "--soft"],
        ] {
            let request = parse(&args).unwrap();
            assert_eq!(request.path, PathBuf::from("Shell.clap"));
            assert_eq!(request.plugin_id.as_deref(), Some("selected.mono"));
            assert!(request.soft);
        }
        let full = parse(&["Shell.clap"]).unwrap();
        assert_eq!(full.plugin_id, None);
        assert!(!full.soft);
    }

    #[test]
    fn malformed_probe_arguments_are_rejected_before_module_loading() {
        for args in [
            vec![],
            vec!["--plugin-id", "selected.mono"],
            vec!["Shell.clap", "--plugin-id"],
            vec!["Shell.clap", "--plugin-id", ""],
            vec!["Shell.clap", "--plugin-id", "--soft"],
            vec![
                "Shell.clap",
                "--plugin-id",
                "selected.mono",
                "--plugin-id",
                "other",
            ],
            vec!["Shell.clap", "other.clap"],
            vec!["--unknown", "Shell.clap"],
        ] {
            assert!(parse(&args).is_err(), "accepted invalid args: {args:?}");
        }
    }
}
