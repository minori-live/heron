//! Bounded atomic sample capture; all FFT and presentation work runs off audio.

use crate::analyzer::{ANALYZER_RING_CAPACITY, DISPLAY_BINS, SpectrumAnalyzer};
pub use crate::analyzer::{AnalyzerConfig, AnalyzerError, AnalyzerResolution, AnalyzerSpeed};
use std::sync::{
    Mutex, MutexGuard,
    atomic::{AtomicU32, AtomicU64, Ordering},
};

const CAPACITY: usize = ANALYZER_RING_CAPACITY;

struct SampleSlot {
    version: AtomicU64,
    samples: [AtomicU32; 6],
}

impl Default for SampleSlot {
    fn default() -> Self {
        Self {
            version: AtomicU64::new(0),
            samples: std::array::from_fn(|_| AtomicU32::new(0)),
        }
    }
}

#[derive(Clone, Debug)]
pub struct SpectrumSnapshot {
    pub frequency_hz: Vec<f32>,
    pub pre_db: Vec<f32>,
    pub post_db: Vec<f32>,
    pub external_db: Vec<f32>,
    pub sample_rate: f64,
    pub sequence: u64,
    pub input_peak: [f32; 2],
    pub output_peak: [f32; 2],
    pub auto_gain_db: f32,
    pub output_gain_db: f32,
    pub bypassed: bool,
    pub static_response_valid: bool,
    pub output_pan_matrix: [[f64; 2]; 2],
    pub output_muted: bool,
    pub age_samples: u64,
    pub invalid_windows: u64,
    pub overwritten_samples: u64,
}

impl Default for SpectrumSnapshot {
    fn default() -> Self {
        Self {
            frequency_hz: Vec::new(),
            pre_db: vec![-120.0; DISPLAY_BINS],
            post_db: vec![-120.0; DISPLAY_BINS],
            external_db: vec![-120.0; DISPLAY_BINS],
            sample_rate: 44100.0,
            sequence: 0,
            input_peak: [0.0; 2],
            output_peak: [0.0; 2],
            auto_gain_db: 0.0,
            output_gain_db: 0.0,
            bypassed: false,
            static_response_valid: true,
            output_pan_matrix: [[1.0, 0.0], [0.0, 1.0]],
            output_muted: false,
            age_samples: 0,
            invalid_windows: 0,
            overwritten_samples: 0,
        }
    }
}

pub struct EqTelemetry {
    slots: Box<[SampleSlot]>,
    head: AtomicU64,
    sample_rate: AtomicU64,
    rate_change_head: AtomicU64,
    input_peak: [AtomicU32; 2],
    output_peak: [AtomicU32; 2],
    auto_gain_db: AtomicU32,
    output_gain_db: AtomicU32,
    bypassed: AtomicU32,
    static_response_valid: AtomicU32,
    output_pan_matrix: [AtomicU64; 4],
    output_pan_version: AtomicU64,
    output_muted: AtomicU32,
    stereo_output: AtomicU32,
    // One coherent RT read: low five bits are band ID; remaining bits identify
    // the editor session owning that audition. Zero means no audition.
    solo: AtomicU64,
    learning: AtomicU32,
    processing_pending: AtomicU32,
    processing_error: AtomicU32,
    response: ResponseSlot,
    active_config: crate::atomic_config::AtomicConfig,
    analyzer: Mutex<SpectrumAnalyzer>,
    parameter_edit: Mutex<()>,
    parameter_epoch: AtomicU64,
    state_restore_revision: AtomicU64,
}

/// UI writers hold the control-thread lock, while audio only observes epoch.
/// Dropping the guard publishes one complete editor transaction.
pub struct ParameterEditGuard<'a> {
    telemetry: &'a EqTelemetry,
    _writer: MutexGuard<'a, ()>,
}
impl Drop for ParameterEditGuard<'_> {
    fn drop(&mut self) {
        self.telemetry
            .parameter_epoch
            .fetch_add(1, Ordering::Release);
    }
}

impl Default for EqTelemetry {
    fn default() -> Self {
        Self {
            slots: (0..CAPACITY).map(|_| SampleSlot::default()).collect(),
            head: AtomicU64::new(0),
            sample_rate: AtomicU64::new(44100.0f64.to_bits()),
            rate_change_head: AtomicU64::new(0),
            input_peak: std::array::from_fn(|_| AtomicU32::new(0)),
            output_peak: std::array::from_fn(|_| AtomicU32::new(0)),
            auto_gain_db: AtomicU32::new(0),
            output_gain_db: AtomicU32::new(0),
            bypassed: AtomicU32::new(0),
            static_response_valid: AtomicU32::new(1),
            output_pan_matrix: [1.0_f64, 0.0, 0.0, 1.0]
                .map(|value| AtomicU64::new(value.to_bits())),
            output_pan_version: AtomicU64::new(0),
            output_muted: AtomicU32::new(0),
            // Before the first audio block the editor uses its stereo preview.
            stereo_output: AtomicU32::new(1),
            solo: AtomicU64::new(0),
            learning: AtomicU32::new(0),
            processing_pending: AtomicU32::new(0),
            processing_error: AtomicU32::new(0),
            response: ResponseSlot::new(),
            active_config: crate::atomic_config::AtomicConfig::default(),
            analyzer: Mutex::new(SpectrumAnalyzer::new()),
            parameter_edit: Mutex::new(()),
            parameter_epoch: AtomicU64::new(0),
            state_restore_revision: AtomicU64::new(0),
        }
    }
}

impl EqTelemetry {
    /// The host editor callback publishes this after restoring parameter values.
    /// It is transient editor invalidation, never part of a saved preset.
    pub(crate) fn state_restored(&self) {
        self.state_restore_revision.fetch_add(1, Ordering::Release);
    }
    pub(crate) fn state_restore_revision(&self) -> u64 {
        self.state_restore_revision.load(Ordering::Acquire)
    }
    pub fn begin_parameter_edit(&self) -> ParameterEditGuard<'_> {
        let writer = self
            .parameter_edit
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.parameter_epoch.fetch_add(1, Ordering::AcqRel);
        ParameterEditGuard {
            telemetry: self,
            _writer: writer,
        }
    }
    pub fn parameter_epoch(&self) -> u64 {
        self.parameter_epoch.load(Ordering::Acquire)
    }
    pub fn sequence(&self) -> u64 {
        self.head.load(Ordering::Acquire)
    }
    pub fn sample_rate(&self) -> f64 {
        f64::from_bits(self.sample_rate.load(Ordering::Acquire))
    }
    pub fn stereo_output(&self) -> bool {
        self.stereo_output.load(Ordering::Acquire) != 0
    }
    pub(crate) fn publish_output_layout_rt(&self, channels: usize) {
        self.stereo_output
            .store(u32::from(channels > 1), Ordering::Release);
    }
    pub fn set_sample_rate(&self, sample_rate: f64) {
        if self.sample_rate.load(Ordering::Acquire) != sample_rate.to_bits() {
            // Publish the boundary first: observing the new rate guarantees a
            // reader also observes the start of the new-rate sample window.
            self.rate_change_head
                .store(self.sequence(), Ordering::Release);
            self.sample_rate
                .store(sample_rate.to_bits(), Ordering::Release);
        }
    }
    #[cfg(test)]
    pub fn set_solo(&self, band_id: Option<u32>) {
        self.solo.store(
            u64::from(band_id.filter(|id| (1..=24).contains(id)).unwrap_or(0)),
            Ordering::Release,
        );
    }
    /// Control-thread publication. The owner is a nonzero session generation.
    pub(crate) fn set_solo_owned(&self, owner: u64, band_id: u32) {
        if owner == 0 || owner > (u64::MAX >> 5) || !(1..=24).contains(&band_id) {
            return;
        }
        self.solo
            .store((owner << 5) | u64::from(band_id), Ordering::Release);
    }
    /// Retired editors may release their own audition, never a newer owner's.
    pub(crate) fn clear_solo_owned(&self, owner: u64) {
        let mut value = self.solo.load(Ordering::Acquire);
        while owner != 0 && value >> 5 == owner {
            match self
                .solo
                .compare_exchange_weak(value, 0, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => break,
                Err(current) => value = current,
            }
        }
    }
    pub fn solo(&self) -> Option<u32> {
        let id = (self.solo.load(Ordering::Acquire) & 31) as u32;
        (id != 0).then_some(id)
    }
    pub fn set_learning(&self, target: Option<u32>) {
        self.learning.store(
            target.map_or(0, |id| id.saturating_add(1)),
            Ordering::Release,
        );
    }
    pub fn learning(&self) -> Option<u32> {
        self.learning.load(Ordering::Acquire).checked_sub(1)
    }
    pub fn processing_pending(&self) -> bool {
        self.processing_pending.load(Ordering::Acquire) != 0
    }
    pub fn processing_error(&self) -> Option<&'static str> {
        match self.processing_error.load(Ordering::Acquire) {
            0 => None,
            1 => Some("The EQ preparation worker could not start"),
            _ => Some(
                "The requested EQ parameters could not be prepared; previous audio settings remain active",
            ),
        }
    }
    pub fn publish_processing(&self, pending: bool, error: u32) {
        self.processing_pending
            .store(u32::from(pending), Ordering::Release);
        self.processing_error.store(error, Ordering::Release);
    }
    pub fn publish_response(&self, response: crate::response::ResponseSnapshot) {
        self.response.publish(&response);
    }
    /// Bounded ~28 KB atomic copy, no frequency calculation or lock on audio.
    pub fn publish_active_response_rt(&self, response: &crate::response::ResponseSnapshot) {
        self.response.publish(response);
    }
    pub fn prepared_response(&self) -> Option<crate::response::ResponseSnapshot> {
        self.response.read()
    }
    pub fn publish_active_config_rt(&self, config: &heron_dsp_core::eq::EqConfig) {
        self.active_config.publish(config, false);
    }
    pub fn active_config(&self) -> Option<heron_dsp_core::eq::EqConfig> {
        self.active_config.read().map(|(_, config, _)| config)
    }
    pub fn clear_active_metadata(&self) {
        self.active_config.clear();
        self.response.version.store(0, Ordering::Release);
    }

    /// Single audio producer; every field is atomic so a slow UI reader never
    /// races Rust memory even when the producer laps the ring.
    pub fn capture(&self, pre: [f32; 2], post: [f32; 2], external: [f32; 2]) {
        let head = self.head.load(Ordering::Relaxed);
        let slot = &self.slots[head as usize % CAPACITY];
        slot.version.swap(head * 2 + 1, Ordering::AcqRel);
        for (target, value) in
            slot.samples
                .iter()
                .zip([pre[0], pre[1], post[0], post[1], external[0], external[1]])
        {
            target.store(value.to_bits(), Ordering::Relaxed);
        }
        slot.version.store(head * 2 + 2, Ordering::Release);
        self.head.store(head + 1, Ordering::Release);
    }

    pub fn publish_levels(
        &self,
        input: [f32; 2],
        output: [f32; 2],
        auto_gain_db: f32,
        output_gain_db: f32,
        bypassed: bool,
        static_response_valid: bool,
    ) {
        for (target, value) in self.input_peak.iter().zip(input) {
            target.store(value.to_bits(), Ordering::Relaxed);
        }
        for (target, value) in self.output_peak.iter().zip(output) {
            target.store(value.to_bits(), Ordering::Relaxed);
        }
        self.auto_gain_db
            .store(auto_gain_db.to_bits(), Ordering::Relaxed);
        self.output_gain_db
            .store(output_gain_db.to_bits(), Ordering::Relaxed);
        self.bypassed.store(u32::from(bypassed), Ordering::Relaxed);
        self.static_response_valid
            .store(u32::from(static_response_valid), Ordering::Relaxed);
    }

    pub fn publish_output_pan_rt(&self, matrix: [[f64; 2]; 2]) {
        self.output_pan_version.fetch_add(1, Ordering::AcqRel);
        for (target, value) in self
            .output_pan_matrix
            .iter()
            .zip(matrix.into_iter().flatten())
        {
            target.store(value.to_bits(), Ordering::Relaxed);
        }
        self.output_pan_version.fetch_add(1, Ordering::Release);
    }
    pub fn publish_output_muted_rt(&self, muted: bool) {
        self.output_muted.store(u32::from(muted), Ordering::Relaxed);
    }
    fn output_pan_matrix(&self) -> [[f64; 2]; 2] {
        for _ in 0..3 {
            let before = self.output_pan_version.load(Ordering::Acquire);
            if !before.is_multiple_of(2) {
                continue;
            }
            let values = self
                .output_pan_matrix
                .each_ref()
                .map(|value| f64::from_bits(value.load(Ordering::Relaxed)));
            std::sync::atomic::fence(Ordering::Acquire);
            if before == self.output_pan_version.load(Ordering::Acquire) {
                return [[values[0], values[1]], [values[2], values[3]]];
            }
        }
        [[1.0, 0.0], [0.0, 1.0]]
    }
    /// Called from editor/analysis threads, never from process().
    pub fn spectrum(&self) -> SpectrumSnapshot {
        self.read_spectrum(false)
    }

    pub fn display_spectrum(&self) -> SpectrumSnapshot {
        self.read_spectrum(true)
    }
    pub fn analyzer_config(&self) -> AnalyzerConfig {
        self.analyzer
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .config()
    }
    pub fn set_analyzer(&self, config: AnalyzerConfig) -> Result<(), AnalyzerError> {
        self.analyzer
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .configure(config)
    }

    fn read_spectrum(&self, display: bool) -> SpectrumSnapshot {
        let (mut snapshot, head) = self.with_analyzer(|analyzer| {
            if display {
                analyzer.display_snapshot()
            } else {
                analyzer.raw_snapshot()
            }
        });
        self.add_live_metadata(&mut snapshot, head);
        snapshot
    }

    pub(crate) fn spectrum_pair(&self) -> (SpectrumSnapshot, SpectrumSnapshot) {
        let ((mut raw, display), head) =
            self.with_analyzer(|analyzer| (analyzer.raw_snapshot(), analyzer.display_snapshot()));
        self.add_live_metadata(&mut raw, head);
        let display = SpectrumSnapshot {
            age_samples: raw.age_samples,
            input_peak: raw.input_peak,
            output_peak: raw.output_peak,
            auto_gain_db: raw.auto_gain_db,
            output_gain_db: raw.output_gain_db,
            bypassed: raw.bypassed,
            static_response_valid: raw.static_response_valid,
            output_pan_matrix: raw.output_pan_matrix,
            output_muted: raw.output_muted,
            ..display
        };
        (raw, display)
    }

    fn with_analyzer<T>(&self, read: impl FnOnce(&SpectrumAnalyzer) -> T) -> (T, u64) {
        let mut analyzer = self
            .analyzer
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let head = self.sequence();
        let sample_rate = self.sample_rate();
        let rate_change_head = self.rate_change_head.load(Ordering::Acquire);
        let _ = analyzer.reset_sample_rate(sample_rate, rate_change_head);
        if analyzer.ready(head, rate_change_head) {
            analyzer.capture_window(head, sample_rate, |sequence| {
                let slot = &self.slots[sequence as usize % CAPACITY];
                let expected = sequence * 2 + 2;
                let before = slot.version.load(Ordering::Acquire);
                let samples = slot
                    .samples
                    .each_ref()
                    .map(|value| f32::from_bits(value.load(Ordering::Relaxed)));
                std::sync::atomic::fence(Ordering::Acquire);
                let after = slot.version.load(Ordering::Acquire);
                (before == expected && after == expected).then_some(samples)
            });
        }
        (read(&analyzer), head)
    }

    fn add_live_metadata(&self, snapshot: &mut SpectrumSnapshot, head: u64) {
        snapshot.age_samples = head.saturating_sub(snapshot.sequence);
        snapshot.input_peak = self
            .input_peak
            .each_ref()
            .map(|value| f32::from_bits(value.load(Ordering::Relaxed)));
        snapshot.output_peak = self
            .output_peak
            .each_ref()
            .map(|value| f32::from_bits(value.load(Ordering::Relaxed)));
        snapshot.auto_gain_db = f32::from_bits(self.auto_gain_db.load(Ordering::Relaxed));
        snapshot.output_gain_db = f32::from_bits(self.output_gain_db.load(Ordering::Relaxed));
        snapshot.bypassed = self.bypassed.load(Ordering::Relaxed) != 0;
        snapshot.static_response_valid = self.static_response_valid.load(Ordering::Relaxed) != 0;
        snapshot.output_pan_matrix = self.output_pan_matrix();
        snapshot.output_muted = self.output_muted.load(Ordering::Relaxed) != 0;
    }
}

struct ResponseSlot {
    version: AtomicU64,
    words: [AtomicU64; 2 + crate::response::RESPONSE_POINTS * 14],
}

impl ResponseSlot {
    fn new() -> Self {
        Self {
            version: AtomicU64::new(0),
            words: std::array::from_fn(|_| AtomicU64::new(0)),
        }
    }
    fn publish(&self, response: &crate::response::ResponseSnapshot) {
        const SIZE: usize = crate::response::RESPONSE_POINTS;
        self.version.fetch_add(1, Ordering::AcqRel);
        self.words[0].store(response.generation, Ordering::Relaxed);
        self.words[1].store(response.sample_rate.to_bits(), Ordering::Relaxed);
        for index in 0..SIZE {
            self.words[2 + index].store(response.frequency_hz[index].to_bits(), Ordering::Relaxed);
        }
        for (channel, values) in [
            &response.stereo_db,
            &response.left_db,
            &response.right_db,
            &response.mid_db,
            &response.side_db,
        ]
        .into_iter()
        .enumerate()
        {
            for (index, value) in values.iter().enumerate() {
                self.words[2 + SIZE * (channel + 1) + index]
                    .store(u64::from(value.to_bits()), Ordering::Relaxed);
            }
        }
        for (index, matrix) in response.matrix.iter().enumerate() {
            let values = [
                matrix.left_to_left.re,
                matrix.left_to_left.im,
                matrix.right_to_left.re,
                matrix.right_to_left.im,
                matrix.left_to_right.re,
                matrix.left_to_right.im,
                matrix.right_to_right.re,
                matrix.right_to_right.im,
            ];
            for (offset, value) in values.into_iter().enumerate() {
                self.words[2 + SIZE * 6 + index * 8 + offset]
                    .store(value.to_bits(), Ordering::Relaxed);
            }
        }
        self.version.fetch_add(1, Ordering::Release);
    }

    fn read(&self) -> Option<crate::response::ResponseSnapshot> {
        const SIZE: usize = crate::response::RESPONSE_POINTS;
        for _ in 0..3 {
            let version = self.version.load(Ordering::Acquire);
            if version == 0 {
                return None;
            }
            if !version.is_multiple_of(2) {
                continue;
            }
            let channel = |channel: usize| {
                std::array::from_fn(|index| {
                    f32::from_bits(
                        self.words[2 + SIZE * (channel + 1) + index].load(Ordering::Relaxed) as u32,
                    )
                })
            };
            let response = crate::response::ResponseSnapshot {
                generation: self.words[0].load(Ordering::Relaxed),
                sample_rate: f64::from_bits(self.words[1].load(Ordering::Relaxed)),
                frequency_hz: std::array::from_fn(|index| {
                    f64::from_bits(self.words[2 + index].load(Ordering::Relaxed))
                }),
                stereo_db: channel(0),
                left_db: channel(1),
                right_db: channel(2),
                mid_db: channel(3),
                side_db: channel(4),
                matrix: std::array::from_fn(|index| {
                    let values: [f64; 8] = std::array::from_fn(|offset| {
                        f64::from_bits(
                            self.words[2 + SIZE * 6 + index * 8 + offset].load(Ordering::Relaxed),
                        )
                    });
                    let complex = |offset| heron_dsp_core::eq::EqResponse {
                        re: values[offset],
                        im: values[offset + 1],
                    };
                    heron_dsp_core::eq::EqResponseMatrix {
                        left_to_left: complex(0),
                        right_to_left: complex(2),
                        left_to_right: complex(4),
                        right_to_right: complex(6),
                    }
                }),
            };
            std::sync::atomic::fence(Ordering::Acquire);
            if version == self.version.load(Ordering::Acquire) {
                return Some(response);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests;
