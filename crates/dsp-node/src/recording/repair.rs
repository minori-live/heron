use super::writer_format::{broadcast_metadata, float_stereo_format, recording_error};
use super::*;

#[napi]
pub fn write_deterministic_test_recording(
    config: NativeRecordingStartConfig,
    sample_rate: u32,
    frame_count: u32,
) -> Result<NativeRecordingResult> {
    if sample_rate == 0 || frame_count == 0 {
        return Err(Error::new(
            Status::InvalidArg,
            "test recording sample rate and frame count must be positive",
        ));
    }
    let mut writer = WaveWriter::create(&config.path, float_stereo_format(sample_rate))
        .map_err(|error| recording_error("failed to create deterministic recording", error))?;
    writer
        .write_broadcast_metadata(&broadcast_metadata(
            &config.asset_id,
            &config.originator,
            &config.origination_date,
            &config.origination_time,
            config.time_reference.max(0) as u64,
            format!("A=PCM,F={sample_rate},W=32,M=stereo,T=Heron deterministic test source\r\n"),
        ))
        .map_err(|error| recording_error("failed to write deterministic BWF metadata", error))?;
    let mut samples = Vec::with_capacity(frame_count as usize * 2);
    for frame in 0..frame_count {
        let sample =
            (std::f32::consts::TAU * 1_000.0 * frame as f32 / sample_rate as f32).sin() * 0.25;
        samples.extend_from_slice(&[sample, sample]);
    }
    let mut audio = writer
        .audio_frame_writer()
        .map_err(|error| recording_error("failed to start deterministic BWF audio", error))?;
    audio
        .write_frames(&samples)
        .map_err(|error| recording_error("failed to write deterministic BWF audio", error))?;
    audio
        .end()
        .map_err(|error| recording_error("failed to finalize deterministic BWF", error))?;
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(&config.path)
        .and_then(|file| file.sync_all())
        .map_err(|error| recording_error("failed to flush deterministic BWF", error))?;
    Ok(NativeRecordingResult {
        path: config.path,
        sample_rate,
        channels: 2,
        frame_count: i64::from(frame_count),
        dropout_frames: 0,
    })
}

#[cfg(test)]
fn write_partial_wave_fixture(path: &std::path::Path, include_data: bool, wave_ok: bool) {
    use std::io::Write;

    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&0_u32.to_le_bytes()); // placeholder size
    bytes.extend_from_slice(if wave_ok { b"WAVE" } else { b"NOTW" });
    // fmt chunk (16-byte PCM float stereo header body)
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&3_u16.to_le_bytes()); // IEEE float
    bytes.extend_from_slice(&2_u16.to_le_bytes());
    bytes.extend_from_slice(&48_000_u32.to_le_bytes());
    bytes.extend_from_slice(&(48_000_u32 * 8).to_le_bytes());
    bytes.extend_from_slice(&8_u16.to_le_bytes());
    bytes.extend_from_slice(&32_u16.to_le_bytes());
    if include_data {
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // unfinished size
        for frame in 0..16_u32 {
            let sample = (frame as f32) * 0.01;
            bytes.extend_from_slice(&sample.to_le_bytes());
            bytes.extend_from_slice(&(-sample).to_le_bytes());
        }
    }
    let riff_size = (bytes.len() as u32).saturating_sub(8);
    bytes[4..8].copy_from_slice(&riff_size.to_le_bytes());
    let mut file = File::create(path).expect("create partial fixture");
    file.write_all(&bytes).expect("write partial fixture");
}

#[napi]
pub fn repair_recording_header(path: String, channels: u32) -> Result<i64> {
    if channels == 0 {
        return Err(Error::new(
            Status::InvalidArg,
            "channel count must be positive",
        ));
    }
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|error| recording_error("failed to open partial recording", error))?;
    let file_length = file
        .metadata()
        .map_err(|error| recording_error("failed to inspect partial recording", error))?
        .len();
    let mut signature = [0_u8; 12];
    file.read_exact(&mut signature)
        .map_err(|error| recording_error("partial recording header is incomplete", error))?;
    if &signature[0..4] != b"RIFF" && &signature[0..4] != b"RF64" {
        return Err(Error::new(
            Status::InvalidArg,
            "partial recording is not RIFF/RF64",
        ));
    }
    if &signature[8..12] != b"WAVE" {
        return Err(Error::new(
            Status::InvalidArg,
            "partial recording is not WAVE",
        ));
    }

    let mut position = 12_u64;
    let mut data_size_offset = None;
    let mut data_start = None;
    while position + 8 <= file_length {
        file.seek(SeekFrom::Start(position))
            .map_err(|error| recording_error("failed to seek partial recording", error))?;
        let mut header = [0_u8; 8];
        file.read_exact(&mut header)
            .map_err(|error| recording_error("partial recording chunk is incomplete", error))?;
        let chunk_size = u32::from_le_bytes(header[4..8].try_into().expect("four bytes")) as u64;
        if &header[0..4] == b"data" {
            data_size_offset = Some(position + 4);
            data_start = Some(position + 8);
            break;
        }
        position = position
            .checked_add(8 + chunk_size + (chunk_size & 1))
            .ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    "partial recording chunk length overflow",
                )
            })?;
    }
    let data_start = data_start
        .ok_or_else(|| Error::new(Status::InvalidArg, "partial recording has no data chunk"))?;
    let data_size_offset = data_size_offset.expect("data offset accompanies data start");
    let data_size = file_length.saturating_sub(data_start);
    let block_alignment = u64::from(channels) * 4;
    let frame_count = data_size / block_alignment;

    if file_length - 8 <= u32::MAX as u64 && data_size <= u32::MAX as u64 {
        file.seek(SeekFrom::Start(0))
            .and_then(|_| file.write_all(b"RIFF"))
            .and_then(|_| file.write_all(&((file_length - 8) as u32).to_le_bytes()))
            .and_then(|_| file.seek(SeekFrom::Start(data_size_offset)))
            .and_then(|_| file.write_all(&(data_size as u32).to_le_bytes()))
            .map_err(|error| recording_error("failed to repair RIFF lengths", error))?;
    } else {
        file.seek(SeekFrom::Start(0))
            .and_then(|_| file.write_all(b"RF64"))
            .and_then(|_| file.write_all(&u32::MAX.to_le_bytes()))
            .and_then(|_| file.seek(SeekFrom::Start(12)))
            .and_then(|_| file.write_all(b"ds64"))
            .and_then(|_| file.write_all(&28_u32.to_le_bytes()))
            .and_then(|_| file.write_all(&(file_length - 8).to_le_bytes()))
            .and_then(|_| file.write_all(&data_size.to_le_bytes()))
            .and_then(|_| file.write_all(&frame_count.to_le_bytes()))
            .and_then(|_| file.write_all(&0_u32.to_le_bytes()))
            .and_then(|_| file.seek(SeekFrom::Start(data_size_offset)))
            .and_then(|_| file.write_all(&u32::MAX.to_le_bytes()))
            .map_err(|error| recording_error("failed to repair RF64 lengths", error))?;
    }
    file.sync_all()
        .map_err(|error| recording_error("failed to flush repaired recording", error))?;
    Ok(frame_count.min(i64::MAX as u64) as i64)
}

#[cfg(test)]
mod header_repair_tests {
    use std::{
        io::{Read, Seek, SeekFrom},
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use std::fs::File;

    use super::{repair_recording_header, write_partial_wave_fixture};

    fn temporary_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time moves forward")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "heron-repair-{label}-{}-{nonce}.bwf",
            std::process::id()
        ))
    }

    #[test]
    fn rejects_zero_channel_count() {
        let path = temporary_path("zero-channels");
        write_partial_wave_fixture(&path, true, true);
        let error = repair_recording_header(path.to_string_lossy().into_owned(), 0)
            .expect_err("zero channels");
        assert!(error.to_string().contains("channel count must be positive"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_missing_file() {
        let path = temporary_path("missing");
        let error = repair_recording_header(path.to_string_lossy().into_owned(), 2)
            .expect_err("missing file");
        assert!(
            error
                .to_string()
                .contains("failed to open partial recording")
        );
    }

    #[test]
    fn rejects_non_riff_signature() {
        let path = temporary_path("not-riff");
        std::fs::write(&path, b"XXXX........WAVE....").unwrap();
        let error =
            repair_recording_header(path.to_string_lossy().into_owned(), 2).expect_err("not riff");
        assert!(error.to_string().contains("not RIFF/RF64"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_non_wave_form_type() {
        let path = temporary_path("not-wave");
        write_partial_wave_fixture(&path, true, false);
        let error =
            repair_recording_header(path.to_string_lossy().into_owned(), 2).expect_err("not wave");
        assert!(error.to_string().contains("not WAVE"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_wave_without_data_chunk() {
        let path = temporary_path("no-data");
        write_partial_wave_fixture(&path, false, true);
        let error =
            repair_recording_header(path.to_string_lossy().into_owned(), 2).expect_err("no data");
        assert!(error.to_string().contains("no data chunk"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_incomplete_header() {
        let path = temporary_path("short-header");
        std::fs::write(&path, b"RIFF").unwrap();
        let error = repair_recording_header(path.to_string_lossy().into_owned(), 2)
            .expect_err("incomplete");
        assert!(error.to_string().contains("header is incomplete"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn repairs_unfinished_riff_data_size() {
        let path = temporary_path("repair-ok");
        write_partial_wave_fixture(&path, true, true);
        let frames =
            repair_recording_header(path.to_string_lossy().into_owned(), 2).expect("repair");
        assert_eq!(frames, 16);

        let mut file = File::open(&path).expect("reopen");
        let mut signature = [0_u8; 12];
        file.read_exact(&mut signature).unwrap();
        assert_eq!(&signature[0..4], b"RIFF");
        assert_eq!(&signature[8..12], b"WAVE");

        // Walk chunks to the data size field and confirm it matches payload bytes.
        let file_length = file.metadata().unwrap().len();
        let mut position = 12_u64;
        let mut data_size = None;
        while position + 8 <= file_length {
            file.seek(SeekFrom::Start(position)).unwrap();
            let mut header = [0_u8; 8];
            file.read_exact(&mut header).unwrap();
            let chunk_size = u32::from_le_bytes(header[4..8].try_into().unwrap()) as u64;
            if &header[0..4] == b"data" {
                data_size = Some(chunk_size);
                break;
            }
            position += 8 + chunk_size + (chunk_size & 1);
        }
        assert_eq!(data_size, Some(16 * 8));
        let _ = std::fs::remove_file(path);
    }
}
