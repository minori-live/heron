//! Versioned portable EQ presets, shared with the fitting-result export.

use heron_dsp_core::eq::EqConfig;
use serde::{Deserialize, Serialize};

const MAX_PRESET_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preset {
    pub format: String,
    pub version: u32,
    pub config: EqConfig,
    #[serde(default = "unity")]
    pub gain_scale: f64,
    #[serde(default)]
    pub phase_invert: bool,
    #[serde(default)]
    pub auto_gain: bool,
    #[serde(default)]
    pub output_pan: f64,
    #[serde(default)]
    pub output_pan_mode: u8,
    #[serde(default)]
    pub output_mute: bool,
}

fn unity() -> f64 {
    1.0
}

impl Preset {
    pub fn new(config: EqConfig) -> Self {
        Self {
            format: "heron-eq".to_owned(),
            version: 1,
            config,
            gain_scale: 1.0,
            phase_invert: false,
            auto_gain: false,
            output_pan: 0.0,
            output_pan_mode: 0,
            output_mute: false,
        }
    }

    pub fn parse(text: &str) -> Result<Self, String> {
        if text.len() > MAX_PRESET_BYTES {
            return Err("The preset is too large.".to_owned());
        }
        let mut payload: serde_json::Value = serde_json::from_str(text)
            .map_err(|_| "This is not a valid Heron EQ preset.".to_owned())?;
        if let Some(fields) = payload.as_object_mut() {
            fields.remove("character");
        }
        let preset: Self = serde_json::from_value(payload)
            .map_err(|_| "This is not a valid Heron EQ preset.".to_owned())?;
        if preset.format != "heron-eq" {
            return Err("This preset belongs to another effect.".to_owned());
        }
        if preset.version != 1 {
            return Err("This preset version is not supported.".to_owned());
        }
        preset
            .config
            .validate(384_000.0)
            .map_err(|_| "The preset contains unsupported EQ settings.".to_owned())?;
        if preset
            .config
            .bands
            .iter()
            .any(|band| !(1..=24).contains(&band.id))
        {
            return Err("The preset contains invalid band identities.".to_owned());
        }
        if !preset.gain_scale.is_finite()
            || !(0.0..=2.0).contains(&preset.gain_scale)
            || !preset.output_pan.is_finite()
            || !(-1.0..=1.0).contains(&preset.output_pan)
            || preset.output_pan_mode > 1
        {
            return Err("The preset contains unsupported output settings.".to_owned());
        }
        Ok(preset)
    }

    pub fn encode(&self) -> Result<String, String> {
        serde_json::to_string_pretty(self)
            .map_err(|_| "The preset could not be encoded.".to_owned())
    }

    pub fn copy(&self) -> Result<(), String> {
        let text = self.encode()?;
        arboard::Clipboard::new()
            .and_then(|mut clipboard| clipboard.set_text(text))
            .map_err(|_| "The clipboard is unavailable.".to_owned())
    }

    pub fn paste() -> Result<Self, String> {
        let text = arboard::Clipboard::new()
            .and_then(|mut clipboard| clipboard.get_text())
            .map_err(|_| "The clipboard does not contain text.".to_owned())?;
        Self::parse(&text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_export_imports_and_future_versions_are_rejected() {
        let envelope =
            serde_json::json!({"format":"heron-eq","version":1,"config":EqConfig::default()});
        let preset = Preset::parse(&envelope.to_string()).expect("fit export is compatible");
        assert!((preset.gain_scale - 1.0).abs() < 0.00001);
        let mut future = envelope;
        future["version"] = serde_json::json!(2);
        assert!(Preset::parse(&future.to_string()).is_err());
    }

    #[test]
    fn full_preset_preserves_output_settings_and_rejects_wrong_product() {
        let mut preset = Preset::new(EqConfig::default());
        preset.phase_invert = true;
        preset.gain_scale = 0.5;
        preset.output_pan = 0.5;
        preset.output_pan_mode = 1;
        preset.output_mute = true;
        let restored =
            Preset::parse(&preset.encode().expect("serializable")).expect("valid preset");
        assert!(restored.phase_invert);
        assert!((restored.gain_scale - 0.5).abs() < 0.0001);
        assert!((restored.output_pan - 0.5).abs() < 1e-9);
        assert_eq!(restored.output_pan_mode, 1);
        assert!(restored.output_mute);
        let mut legacy = serde_json::to_value(&preset).expect("serializable");
        legacy["character"] = serde_json::json!(2);
        let restored_legacy = Preset::parse(&legacy.to_string()).expect("legacy field is ignored");
        assert_eq!(
            restored_legacy.encode().expect("serializable"),
            preset.encode().expect("serializable"),
            "retired character settings cannot enter the current output schema"
        );
        legacy["unknown_output_setting"] = serde_json::json!(true);
        assert!(
            Preset::parse(&legacy.to_string()).is_err(),
            "ignoring one retired field must not accept unrelated settings"
        );
        preset.format = "another-effect".to_owned();
        assert!(Preset::parse(&preset.encode().expect("serializable")).is_err());
    }

    #[test]
    fn fitting_fixture_import_keeps_frequency_q_gain_and_shape() {
        let preset = Preset::parse(include_str!("../../tests/fixtures/fit-preset.json"))
            .expect("renderer-produced preset");
        assert_eq!(preset.config.bands.len(), 3);
        assert_eq!(
            preset.config.bands[0].shape,
            heron_dsp_core::eq::EqShape::LowShelf
        );
        assert!((preset.config.bands[0].frequency_hz - 180.0).abs() < 0.0001);
        assert!((preset.config.bands[1].gain_db + 5.0).abs() < 0.0001);
        assert!((preset.config.bands[1].q - 1.2).abs() < 0.0001);
        assert!((preset.config.bands[0].slope_db_oct - 12.0).abs() < 0.0001);
    }

    #[test]
    fn fitting_fixture_matches_actual_native_processor_response() {
        #[derive(Deserialize)]
        struct Expected {
            sample_rate: f64,
            frequency_hz: Vec<f64>,
            magnitude_db: Vec<f64>,
        }
        let expected: Expected =
            serde_json::from_str(include_str!("../../tests/fixtures/fit-response.json"))
                .expect("shared fixture");
        let preset = Preset::parse(include_str!("../../tests/fixtures/fit-preset.json"))
            .expect("renderer export");
        let processor =
            heron_dsp_core::eq::EqProcessor::prepare(&preset.config, expected.sample_rate)
                .expect("valid native EQ");
        assert_eq!(expected.frequency_hz.len(), expected.magnitude_db.len());
        for (frequency, expected) in expected.frequency_hz.into_iter().zip(expected.magnitude_db) {
            let actual = processor
                .response_matrix(frequency)
                .magnitude_db(heron_dsp_core::eq::EqChannel::Stereo);
            assert!(
                (actual - expected).abs() < 1e-7,
                "{frequency} Hz: expected {expected}, got {actual}"
            );
        }
    }
}
