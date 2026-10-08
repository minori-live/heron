//! Portable selected-band transfer; validate before changing destination state.

use super::{model::Model, preset::Preset};
use heron_dsp_core::eq::{EqConfig, MAX_EQ_BANDS};

pub fn copy(model: &Model) -> Result<(), String> {
    let bands = model
        .config
        .bands
        .iter()
        .filter(|band| model.selected.contains(&band.id))
        .copied()
        .collect::<Vec<_>>();
    if bands.is_empty() {
        return Err("Select bands to copy first.".to_owned());
    }
    Preset::new(EqConfig {
        bands,
        output_gain_db: 0.0,
        bypass: false,
        ..model.config.clone()
    })
    .copy()
}

pub fn append(model: &mut Model, preset: Preset, sample_rate: f64) -> Result<usize, String> {
    let count = preset.config.bands.len();
    if count == 0 {
        return Err("The clipboard preset does not contain bands.".to_owned());
    }
    if model.config.bands.len() + count > MAX_EQ_BANDS {
        return Err("Pasting all copied bands would exceed the 24-band limit.".to_owned());
    }
    let free_ids: Vec<_> = (1..=MAX_EQ_BANDS as u32)
        .filter(|id| !model.config.bands.iter().any(|band| band.id == *id))
        .take(count)
        .collect();
    if free_ids.len() != count {
        return Err("There are not enough free band slots.".to_owned());
    }
    let mut config = model.config.clone();
    for (mut band, id) in preset.config.bands.into_iter().zip(&free_ids) {
        band.id = *id;
        config.bands.push(band);
    }
    config.validate(sample_rate).map_err(|_| {
        "The copied bands are incompatible with this processing mode or sample rate.".to_owned()
    })?;
    model.config = config;
    model.selected = free_ids.into_iter().collect();
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use heron_dsp_core::eq::{EqBand, EqChannel};
    #[test]
    fn transfer_preserves_destination_globals_and_serial_order_assigning_only_free_ids() {
        let mut target = Model::new(EqConfig {
            bands: vec![
                EqBand {
                    id: 1,
                    channel: EqChannel::Mid,
                    ..Default::default()
                },
                EqBand {
                    id: 3,
                    ..Default::default()
                },
            ],
            output_gain_db: -6.0,
            ..Default::default()
        });
        let source = Preset::new(EqConfig {
            bands: vec![
                EqBand {
                    id: 9,
                    frequency_hz: 500.0,
                    channel: EqChannel::Side,
                    ..Default::default()
                },
                EqBand {
                    id: 2,
                    frequency_hz: 2000.0,
                    ..Default::default()
                },
            ],
            ..Default::default()
        });
        let count = append(&mut target, source, 48000.0).unwrap();
        assert_eq!(count, 2);
        assert_eq!(
            target
                .config
                .bands
                .iter()
                .map(|band| band.id)
                .collect::<Vec<_>>(),
            vec![1, 3, 2, 4]
        );
        assert_eq!(target.config.output_gain_db, -6.0);
        assert_eq!(target.config.bands[2].channel, EqChannel::Side);
        assert_eq!(target.selected.into_iter().collect::<Vec<_>>(), vec![2, 4]);
    }
    #[test]
    fn capacity_or_sample_rate_failure_keeps_every_band_and_selection_unchanged() {
        let mut target = Model::new(EqConfig {
            bands: (1..=24)
                .map(|id| EqBand {
                    id,
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        });
        let before = target.config.clone();
        let selected = target.selected.clone();
        let source = Preset::new(EqConfig {
            bands: vec![EqBand {
                id: 1,
                ..Default::default()
            }],
            ..Default::default()
        });
        assert!(append(&mut target, source, 48000.0).is_err());
        assert_eq!(target.config, before);
        assert_eq!(target.selected, selected);
        target.config.bands.truncate(1);
        let before = target.config.clone();
        let source = Preset::new(EqConfig {
            bands: vec![EqBand {
                id: 1,
                frequency_hz: 20000.0,
                ..Default::default()
            }],
            ..Default::default()
        });
        assert!(append(&mut target, source, 22050.0).is_err());
        assert_eq!(target.config, before);
    }
}
