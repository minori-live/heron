use super::*;

#[napi(object)]
pub struct NativeWaveformLevel {
    pub frames_per_bucket: u32,
    pub bucket_count: u32,
    pub peaks: Buffer,
}

#[napi(object)]
pub struct NativeAnalyzedWaveform {
    pub sample_rate: u32,
    pub channels: u32,
    pub frame_count: i64,
    pub waveform_levels: Vec<NativeWaveformLevel>,
}

#[napi(object)]
pub struct NativeRecordingStartConfig {
    pub path: String,
    pub asset_id: String,
    pub originator: String,
    pub origination_date: String,
    pub origination_time: String,
    pub time_reference: i64,
}

#[napi(object)]
pub struct NativeRecordingResult {
    pub path: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub frame_count: i64,
    pub dropout_frames: i64,
}

#[napi(object)]
pub struct NativeFinalizeRecordingConfig {
    pub input_path: String,
    pub output_path: String,
    pub target_sample_rate: u32,
    pub bit_depth: String,
    pub asset_id: String,
    pub originator: String,
    pub origination_date: String,
    pub origination_time: String,
    pub time_reference: i64,
    pub channel_indices: Option<Vec<u32>>,
}

#[napi(object)]
pub struct NativeFinalizedRecording {
    pub path: String,
    pub content_hash: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub bit_depth: String,
    pub frame_count: i64,
    pub time_reference: i64,
    pub waveform_levels: Vec<NativeWaveformLevel>,
}

fn finite_sample(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

fn encode_peaks(values: &[f32]) -> Buffer {
    let mut bytes = Vec::with_capacity(std::mem::size_of_val(values));
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes.into()
}

fn aggregate_peak_level(source: &[f32], channels: usize) -> Vec<f32> {
    let stride = channels * 2;
    let buckets = source.len() / stride;
    let mut result = Vec::with_capacity(buckets.div_ceil(WAVEFORM_LEVEL_FACTOR) * stride);
    for group_start in (0..buckets).step_by(WAVEFORM_LEVEL_FACTOR) {
        let group_end = (group_start + WAVEFORM_LEVEL_FACTOR).min(buckets);
        for channel in 0..channels {
            let mut minimum = 1.0_f32;
            let mut maximum = -1.0_f32;
            for bucket in group_start..group_end {
                let offset = bucket * stride + channel * 2;
                minimum = minimum.min(source[offset]);
                maximum = maximum.max(source[offset + 1]);
            }
            result.extend_from_slice(&[minimum, maximum]);
        }
    }
    result
}

pub(super) fn base_peak_level(samples: &[f32], channels: usize) -> Vec<f32> {
    let frames = samples.len() / channels;
    let mut peaks = Vec::with_capacity(frames.div_ceil(WAVEFORM_BASE_FRAMES) * channels * 2);
    for start in (0..frames).step_by(WAVEFORM_BASE_FRAMES) {
        let end = (start + WAVEFORM_BASE_FRAMES).min(frames);
        for channel in 0..channels {
            let mut minimum = 1.0_f32;
            let mut maximum = -1.0_f32;
            for frame in start..end {
                let sample = finite_sample(samples[frame * channels + channel]);
                minimum = minimum.min(sample);
                maximum = maximum.max(sample);
            }
            peaks.extend_from_slice(&[minimum, maximum]);
        }
    }
    peaks
}

pub(super) fn build_waveform_levels(samples: &[f32], channels: usize) -> Vec<NativeWaveformLevel> {
    if channels == 0 || samples.is_empty() {
        return Vec::new();
    }
    let mut frames_per_bucket = WAVEFORM_BASE_FRAMES;
    let mut values = base_peak_level(samples, channels);
    let mut result = Vec::new();
    loop {
        let bucket_count = values.len() / (channels * 2);
        result.push(NativeWaveformLevel {
            frames_per_bucket: frames_per_bucket as u32,
            bucket_count: bucket_count as u32,
            peaks: encode_peaks(&values),
        });
        if bucket_count <= 1 {
            break;
        }
        values = aggregate_peak_level(&values, channels);
        frames_per_bucket *= WAVEFORM_LEVEL_FACTOR;
    }
    result
}
