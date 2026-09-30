use std::{
    f32::consts::TAU,
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use bwavfile::{WaveReader, WaveWriter};

use crate::recording::{
    NativeFinalizeRecordingConfig,
    finalize::{TpdfDither, finalize},
    repair_recording_header,
    waveform::base_peak_level,
    waveform_analysis::analyze_waveform_path,
    writer_format::{broadcast_metadata, float_stereo_format},
};

fn temporary_file(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time moves forward")
        .as_nanos();
    std::env::temp_dir().join(format!("heron-{label}-{}-{nonce}.bwf", std::process::id()))
}

#[test]
fn base_waveform_uses_exact_multichannel_extrema_and_sanitizes_samples() {
    let mut samples = vec![0.0_f32; 65 * 3];
    samples[0..3].copy_from_slice(&[-1.0, 0.25, f32::NAN]);
    samples[63 * 3..63 * 3 + 3].copy_from_slice(&[0.5, f32::INFINITY, -0.75]);
    samples[64 * 3..64 * 3 + 3].copy_from_slice(&[0.125, -0.5, 1.5]);
    assert_eq!(
        base_peak_level(&samples, 3),
        vec![
            -1.0, 0.5, 0.0, 0.25, -0.75, 0.0, 0.125, 0.125, -0.5, -0.5, 1.0, 1.0
        ]
    );
}

#[test]
fn float_swap_format_is_stereo_32_bit() {
    let format = float_stereo_format(48_000);
    assert_eq!(format.channel_count, 2);
    assert_eq!(format.bits_per_sample, 32);
    assert_eq!(format.block_alignment, 8);
}

#[test]
fn broadcast_metadata_keeps_time_reference_and_asset_id() {
    let metadata = broadcast_metadata(
        "asset-id",
        "Heron",
        "2026-07-22",
        "12:00:00",
        42,
        String::new(),
    );
    assert_eq!(metadata.originator_reference, "asset-id");
    assert_eq!(metadata.time_reference, 42);
}

#[test]
fn tpdf_dither_is_deterministic_and_never_clips() {
    let mut first = TpdfDither::new(b"fixed-seed");
    let mut second = TpdfDither::new(b"fixed-seed");
    for sample in [-1.0, -0.5, 0.0, 0.5, 1.0] {
        let a = first.apply(sample, 16);
        let b = second.apply(sample, 16);
        assert_eq!(a, b);
        assert!((-1.0..1.0).contains(&a));
    }
}

#[test]
fn repairs_an_unfinished_data_chunk() {
    let path = temporary_file("repair");
    let writer = WaveWriter::create(&path, float_stereo_format(48_000)).unwrap();
    let mut audio = writer.audio_frame_writer().unwrap();
    audio.write_frames(&vec![0.5_f32; 64]).unwrap();
    drop(audio);

    let frames = repair_recording_header(path.to_string_lossy().into_owned(), 2).unwrap();
    assert_eq!(frames, 32);
    let mut reader = WaveReader::open(&path).unwrap();
    assert_eq!(reader.frame_length().unwrap(), 32);
    fs::remove_file(path).unwrap();
}

#[test]
fn fft_resampling_preserves_sine_length_frequency_and_all_final_formats() {
    let source = temporary_file("source-sine");
    let mut writer = WaveWriter::create(&source, float_stereo_format(44_100)).unwrap();
    writer
        .write_broadcast_metadata(&broadcast_metadata(
            "source",
            "Heron test",
            "2026-07-22",
            "12:00:00",
            0,
            String::new(),
        ))
        .unwrap();
    let mut audio = writer.audio_frame_writer().unwrap();
    let input_frames = 4_410;
    let mut sine = Vec::with_capacity(input_frames * 2);
    for frame in 0..input_frames {
        let sample = (TAU * 1_000.0 * frame as f32 / 44_100.0).sin() * 0.5;
        sine.extend_from_slice(&[sample, sample]);
    }
    audio.write_frames(&sine).unwrap();
    audio.end().unwrap();

    for bit_depth in ["float32", "pcm24", "pcm16"] {
        let output = temporary_file(bit_depth);
        let finalized = finalize(&NativeFinalizeRecordingConfig {
            input_path: source.to_string_lossy().into_owned(),
            output_path: output.to_string_lossy().into_owned(),
            target_sample_rate: 48_000,
            bit_depth: bit_depth.to_owned(),
            asset_id: format!("asset-{bit_depth}"),
            originator: "Heron test".to_owned(),
            origination_date: "2026-07-22".to_owned(),
            origination_time: "12:00:00".to_owned(),
            time_reference: 123,
            channel_indices: None,
        })
        .unwrap();
        assert!((finalized.frame_count - 4_800).abs() <= 1);
        assert_eq!(finalized.bit_depth, bit_depth);
        let mut reader = WaveReader::open(&output).unwrap();
        assert_eq!(
            reader.format().unwrap().bits_per_sample,
            match bit_depth {
                "pcm24" => 24,
                "pcm16" => 16,
                _ => 32,
            }
        );
        assert_eq!(
            reader
                .broadcast_extension()
                .unwrap()
                .unwrap()
                .time_reference,
            123
        );
        if bit_depth == "float32" {
            let frame_count = reader.frame_length().unwrap() as usize;
            let mut rendered = vec![0.0_f32; frame_count * 2];
            reader
                .audio_frame_reader()
                .unwrap()
                .read_frames(&mut rendered)
                .unwrap();
            let left: Vec<f32> = rendered
                .as_chunks::<2>()
                .0
                .iter()
                .map(|frame| frame[0])
                .collect();
            let mut below = false;
            let mut positive_crossings = 0;
            for sample in &left {
                if *sample < -0.1 {
                    below = true;
                } else if below && *sample > 0.1 {
                    positive_crossings += 1;
                    below = false;
                }
            }
            assert!(
                (95..=105).contains(&positive_crossings),
                "unexpected positive crossing count: {positive_crossings}"
            );
            let peak = left
                .iter()
                .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
            assert!((peak - 0.5).abs() < 0.01);
        }
        assert_eq!(finalized.content_hash.len(), 64);
        let analyzed = analyze_waveform_path(output.to_str().unwrap()).unwrap();
        assert_eq!(
            finalized.waveform_levels.len(),
            analyzed.waveform_levels.len()
        );
        for (cached, actual) in finalized
            .waveform_levels
            .iter()
            .zip(analyzed.waveform_levels.iter())
        {
            assert_eq!(cached.frames_per_bucket, actual.frames_per_bucket);
            assert_eq!(cached.bucket_count, actual.bucket_count);
            assert_eq!(cached.peaks.as_ref(), actual.peaks.as_ref());
        }
        fs::remove_file(output).unwrap();
    }
    fs::remove_file(source).unwrap();
}
