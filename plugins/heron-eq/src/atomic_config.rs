//! Fixed, coherent parameter snapshots. Audio publishes into preallocated
//! atomics; control readers allocate their editable vector after taking a copy.
use crate::params::{CHANNELS, MODES, RESOLUTIONS, SHAPES};
use heron_dsp_core::eq::{EqBand, EqConfig, MAX_EQ_BANDS};
use std::sync::atomic::{AtomicU64, Ordering};

const HEADER: usize = 6;
const FIELDS: usize = 8;
const WORDS: usize = HEADER + MAX_EQ_BANDS * FIELDS;

pub struct AtomicConfig {
    words: [AtomicU64; WORDS],
    version: AtomicU64,
}

impl Default for AtomicConfig {
    fn default() -> Self {
        Self {
            words: std::array::from_fn(|_| AtomicU64::new(0)),
            version: AtomicU64::new(0),
        }
    }
}

impl AtomicConfig {
    pub fn clear(&self) {
        self.version.store(0, Ordering::Release);
    }
    pub fn version(&self) -> u64 {
        self.version.load(Ordering::Acquire)
    }

    pub fn publish(&self, config: &EqConfig, prepare: bool) -> u64 {
        self.version.fetch_add(1, Ordering::AcqRel);
        self.words[0].store(config.bands.len() as u64, Ordering::Relaxed);
        self.words[1].store(config.output_gain_db.to_bits(), Ordering::Relaxed);
        self.words[2].store(u64::from(config.bypass), Ordering::Relaxed);
        self.words[3].store(
            MODES
                .iter()
                .position(|mode| *mode == config.processing_mode)
                .unwrap_or(0) as u64,
            Ordering::Relaxed,
        );
        self.words[4].store(
            RESOLUTIONS
                .iter()
                .position(|resolution| *resolution == config.linear_phase_resolution)
                .unwrap_or(2) as u64,
            Ordering::Relaxed,
        );
        self.words[5].store(u64::from(prepare), Ordering::Relaxed);
        for (index, band) in config.bands.iter().enumerate() {
            let values = [
                u64::from(band.id),
                u64::from(band.enabled),
                SHAPES
                    .iter()
                    .position(|shape| *shape == band.shape)
                    .unwrap_or(0) as u64,
                band.frequency_hz.to_bits(),
                band.gain_db.to_bits(),
                band.q.to_bits(),
                band.slope_db_oct.to_bits(),
                CHANNELS
                    .iter()
                    .position(|channel| *channel == band.channel)
                    .unwrap_or(0) as u64,
            ];
            for (offset, value) in values.into_iter().enumerate() {
                self.words[HEADER + index * FIELDS + offset].store(value, Ordering::Relaxed);
            }
        }
        self.version.fetch_add(1, Ordering::Release) + 1
    }

    pub fn read(&self) -> Option<(u64, EqConfig, bool)> {
        for _ in 0..3 {
            let generation = self.version();
            if generation == 0 || !generation.is_multiple_of(2) {
                continue;
            }
            let words: [u64; WORDS] =
                std::array::from_fn(|index| self.words[index].load(Ordering::Relaxed));
            std::sync::atomic::fence(Ordering::Acquire);
            if generation != self.version() {
                continue;
            }
            let mut config = EqConfig {
                bands: Vec::with_capacity(MAX_EQ_BANDS),
                output_gain_db: f64::from_bits(words[1]),
                bypass: words[2] != 0,
                processing_mode: MODES[(words[3] as usize).min(2)],
                linear_phase_resolution: RESOLUTIONS[(words[4] as usize).min(4)],
            };
            for index in 0..(words[0] as usize).min(MAX_EQ_BANDS) {
                let values = &words[HEADER + index * FIELDS..HEADER + (index + 1) * FIELDS];
                config.bands.push(EqBand {
                    id: values[0] as u32,
                    enabled: values[1] != 0,
                    shape: SHAPES[(values[2] as usize).min(9)],
                    frequency_hz: f64::from_bits(values[3]),
                    gain_db: f64::from_bits(values[4]),
                    q: f64::from_bits(values[5]),
                    slope_db_oct: f64::from_bits(values[6]),
                    channel: CHANNELS[(values[7] as usize).min(4)],
                });
            }
            return Some((generation, config, words[5] != 0));
        }
        None
    }
}
