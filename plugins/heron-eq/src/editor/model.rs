//! Editor-owned selection and reversible gestures; audio state remains in parameters.

use std::collections::BTreeSet;

use heron_dsp_core::eq::{EqBand, EqChannel, EqConfig, EqShape, MAX_EQ_BANDS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SplitError {
    Capacity,
    InvalidPair,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Extras {
    pub gain_scale: f64,
    pub phase_invert: bool,
    pub auto_gain: bool,
    pub output_pan: f64,
    pub output_pan_mode: u8,
    pub output_mute: bool,
}

impl Default for Extras {
    fn default() -> Self {
        Self {
            gain_scale: 1.0,
            phase_invert: false,
            auto_gain: false,
            output_pan: 0.0,
            output_pan_mode: 0,
            output_mute: false,
        }
    }
}

#[derive(Clone, PartialEq)]
struct Snapshot {
    config: EqConfig,
    extras: Extras,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Number {
    Frequency,
    Gain,
    Q,
    Output,
    Pan,
    Slope,
}

impl Number {
    pub fn value(self, band: &EqBand, output: f64) -> f64 {
        match self {
            Self::Frequency => band.frequency_hz,
            Self::Gain => band.gain_db,
            Self::Q => band.q,
            Self::Output | Self::Pan => output,
            Self::Slope => band.slope_db_oct,
        }
    }

    fn set(self, band: &mut EqBand, value: f64) {
        match self {
            Self::Frequency => band.frequency_hz = value.clamp(10.0, 30_000.0),
            Self::Gain => band.gain_db = value.clamp(-36.0, 36.0),
            Self::Q => band.q = value.clamp(0.025, 40.0),
            Self::Output | Self::Pan => {}
            Self::Slope => band.slope_db_oct = value,
        }
    }
}

pub struct Model {
    pub config: EqConfig,
    pub extras: Extras,
    pub selected: BTreeSet<u32>,
    gesture: Option<Snapshot>,
    pub solo: Option<u32>,
}

impl Model {
    pub fn new(config: EqConfig) -> Self {
        let selected = config
            .bands
            .first()
            .map(|band| band.id)
            .into_iter()
            .collect();
        Self {
            config,
            extras: Extras::default(),
            selected,
            gesture: None,
            solo: None,
        }
    }

    pub fn focused(&self) -> Option<&EqBand> {
        self.config
            .bands
            .iter()
            .find(|band| self.selected.contains(&band.id))
    }

    pub fn select(&mut self, id: u32, additive: bool) {
        if additive {
            if !self.selected.insert(id) {
                self.selected.remove(&id);
            }
        } else if !self.selected.contains(&id) {
            self.selected.clear();
            self.selected.insert(id);
        }
    }

    pub fn synchronize(&mut self, config: EqConfig) {
        if self.gesture.is_none() {
            self.config = config;
            self.selected
                .retain(|id| self.config.bands.iter().any(|band| band.id == *id));
        }
    }

    pub fn synchronize_extras(&mut self, extras: Extras) {
        if self.gesture.is_none() {
            self.extras = extras;
        }
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            config: self.config.clone(),
            extras: self.extras,
        }
    }

    fn restore(&mut self, snapshot: Snapshot) {
        self.config = snapshot.config;
        self.extras = snapshot.extras;
    }

    pub fn begin(&mut self) {
        if self.gesture.is_none() {
            self.gesture = Some(self.snapshot());
        }
    }

    pub fn has_gesture(&self) -> bool {
        self.gesture.is_some()
    }

    pub fn end(&mut self) {
        self.gesture = None;
    }

    pub fn cancel(&mut self) {
        if let Some(before) = self.gesture.take() {
            self.restore(before);
        }
    }

    #[cfg(test)]
    pub fn change(&mut self, action: impl FnOnce(&mut Self)) {
        action(self);
    }

    pub fn change_checked(
        &mut self,
        action: impl FnOnce(&mut Self),
        sample_rate: f64,
    ) -> Result<(), heron_dsp_core::eq::EqError> {
        let before = self.snapshot();
        action(self);
        if let Err(error) = self.config.validate(sample_rate) {
            self.restore(before);
            return Err(error);
        }
        Ok(())
    }

    pub fn edit_selected(&mut self, mut action: impl FnMut(&mut EqBand)) {
        for band in &mut self.config.bands {
            if self.selected.contains(&band.id) {
                action(band);
            }
        }
    }

    pub fn add(&mut self, frequency: f64, gain: f64) -> Option<u32> {
        if self.config.bands.len() >= MAX_EQ_BANDS {
            return None;
        }
        let id = (1..=u32::try_from(MAX_EQ_BANDS).ok()?)
            .find(|id| !self.config.bands.iter().any(|band| band.id == *id))?;
        self.config.bands.push(EqBand {
            id,
            frequency_hz: frequency.clamp(10.0, 30_000.0),
            gain_db: gain.clamp(-30.0, 30.0),
            ..EqBand::default()
        });
        self.selected.clear();
        self.selected.insert(id);
        Some(id)
    }

    pub fn remove_selected(&mut self) {
        self.config
            .bands
            .retain(|band| !self.selected.contains(&band.id));
        if self.solo.is_some_and(|id| self.selected.contains(&id)) {
            self.solo = None;
        }
        self.selected.clear();
    }

    pub fn duplicate_selected(&mut self) {
        let copies: Vec<_> = self
            .config
            .bands
            .iter()
            .filter(|band| self.selected.contains(&band.id))
            .cloned()
            .collect();
        let mut selected = BTreeSet::new();
        for mut band in copies {
            if self.config.bands.len() >= MAX_EQ_BANDS {
                break;
            }
            let Some(id) =
                (1..=24).find(|id| !self.config.bands.iter().any(|existing| existing.id == *id))
            else {
                break;
            };
            band.id = id;
            self.config.bands.push(band);
            selected.insert(id);
        }
        if !selected.is_empty() {
            self.selected = selected;
        }
    }

    /// Split selected stereo bands without changing either existing channel
    /// bands or their IDs. Call through `change_checked` to validate the result.
    /// Capacity is checked for the complete selection before any mutation.
    pub fn split_selected(
        &mut self,
        first: EqChannel,
        second: EqChannel,
    ) -> Result<usize, SplitError> {
        if !matches!(
            (first, second),
            (EqChannel::Left, EqChannel::Right) | (EqChannel::Mid, EqChannel::Side)
        ) {
            return Err(SplitError::InvalidPair);
        }
        let count = self
            .config
            .bands
            .iter()
            .filter(|band| self.selected.contains(&band.id) && band.channel == EqChannel::Stereo)
            .count();
        if count == 0 {
            return Ok(0);
        }
        let free_ids: Vec<_> = (1..=MAX_EQ_BANDS as u32)
            .filter(|id| !self.config.bands.iter().any(|band| band.id == *id))
            .take(count)
            .collect();
        if self.config.bands.len() + count > MAX_EQ_BANDS || free_ids.len() != count {
            return Err(SplitError::Capacity);
        }
        let mut bands = Vec::with_capacity(self.config.bands.len() + count);
        let mut next_id = 0;
        for band in &self.config.bands {
            if self.selected.contains(&band.id) && band.channel == EqChannel::Stereo {
                let id = free_ids[next_id];
                next_id += 1;
                bands.push(EqBand {
                    channel: first,
                    ..*band
                });
                // Keep both halves adjacent so a following M/S or L/R filter
                // receives the same signal as it did from the stereo band.
                bands.push(EqBand {
                    id,
                    channel: second,
                    ..*band
                });
            } else {
                bands.push(*band);
            }
        }
        self.config.bands = bands;
        self.selected.extend(free_ids);
        Ok(count)
    }

    pub fn drag(&mut self, frequency_ratio: f64, gain_delta: f64) {
        let Some(start) = &self.gesture else { return };
        for band in &mut self.config.bands {
            if !self.selected.contains(&band.id) {
                continue;
            }
            if let Some(initial) = start
                .config
                .bands
                .iter()
                .find(|initial| initial.id == band.id)
            {
                band.frequency_hz = (initial.frequency_hz * frequency_ratio).clamp(10.0, 30_000.0);
                band.gain_db = (initial.gain_db + gain_delta).clamp(-30.0, 30.0);
            }
        }
    }

    pub fn number(&mut self, field: Number, value: f64) {
        if !value.is_finite() {
            return;
        }
        if field == Number::Output {
            self.config.output_gain_db = value.clamp(-60.0, 60.0);
        } else if field == Number::Pan {
            self.extras.output_pan = value.clamp(-1.0, 1.0);
        } else {
            self.edit_selected(|band| field.set(band, value));
        }
    }

    /// Rotary controls apply one relative adjustment to the initial selection.
    /// Repeated drag updates therefore preserve each band's frequency/Q ratio
    /// and gain offset. The initial snapshot is retained for gesture cancellation.
    pub fn knob(&mut self, field: Number, value: f64) {
        if !value.is_finite() {
            return;
        }
        if matches!(field, Number::Output | Number::Pan) {
            self.number(field, value);
            return;
        }
        let Some(focused_id) = self.focused().map(|band| band.id) else {
            return;
        };
        let Some(start) = &self.gesture else {
            return;
        };
        let Some(focused) = start.config.bands.iter().find(|band| band.id == focused_id) else {
            return;
        };
        let initial_value = |band: &EqBand| field.value(band, start.config.output_gain_db);
        let focused_value = initial_value(focused);
        let ratio = value / focused_value.max(f64::MIN_POSITIVE);
        let delta = value - focused_value;
        for band in &mut self.config.bands {
            if !self.selected.contains(&band.id) {
                continue;
            }
            let Some(initial) = start
                .config
                .bands
                .iter()
                .find(|initial| initial.id == band.id)
            else {
                continue;
            };
            let initial = initial_value(initial);
            let value = match field {
                Number::Frequency | Number::Q => initial * ratio,
                Number::Gain => initial + delta,
                _ => value,
            };
            field.set(band, value);
        }
    }

    pub fn wheel_q(&mut self, id: u32, delta: f64) {
        if !self.selected.contains(&id) {
            self.selected.clear();
            self.selected.insert(id);
        }
        self.edit_selected(|band| band.q = (band.q * 1.12_f64.powf(delta)).clamp(0.025, 40.0));
    }

    pub fn shape(&mut self, shape: EqShape) {
        self.edit_selected(|band| band.shape = shape);
    }
    pub fn channel(&mut self, channel: EqChannel) {
        self.edit_selected(|band| band.channel = channel);
    }
}

#[cfg(test)]
mod tests;
