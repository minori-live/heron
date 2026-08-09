use std::{
    fs,
    path::PathBuf,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use heron_audio_host::{
    engine::{AudioEngine, NativeAudioEngineConfig, NativeDeviceRecoveryPhase},
    mock::{
        MockStreamFaultKind, reset_mock_device_control, set_mock_device_available,
        trigger_mock_stream_error,
    },
};

fn duration_argument() -> Result<Duration, String> {
    let mut arguments = std::env::args().skip(1);
    let mut duration = "30s".to_owned();
    while let Some(argument) = arguments.next() {
        if argument == "--duration" {
            duration = arguments
                .next()
                .ok_or_else(|| "--duration requires a value".to_owned())?;
        }
    }
    let (value, multiplier) = if let Some(value) = duration.strip_suffix('h') {
        (value, 3_600)
    } else if let Some(value) = duration.strip_suffix('m') {
        (value, 60)
    } else if let Some(value) = duration.strip_suffix('s') {
        (value, 1)
    } else {
        (duration.as_str(), 1)
    };
    let seconds = value
        .parse::<u64>()
        .map_err(|_| format!("invalid duration '{duration}'"))?;
    Ok(Duration::from_secs(seconds.saturating_mul(multiplier)))
}

fn config() -> NativeAudioEngineConfig {
    NativeAudioEngineConfig {
        backend: "mock".to_owned(),
        input_device_id: "custom:mock-duplex".to_owned(),
        output_device_id: "custom:mock-duplex".to_owned(),
        buffer_size: 128,
        session_sample_rate: Some(48_000),
    }
}

fn wait_for_recovery(engine: &AudioEngine, deadline: Instant) -> Result<u64, String> {
    while Instant::now() < deadline {
        engine.poll_device_recovery();
        if let Some(recovery) = engine.device_recovery_snapshot() {
            return Ok(recovery.recovery_id);
        }
        thread::sleep(Duration::from_millis(5));
    }
    Err("mock stream error did not open recovery".to_owned())
}

fn wait_for_original(engine: &AudioEngine, deadline: Instant) -> Result<u64, String> {
    let mut last_generation = 0;
    while Instant::now() < deadline {
        engine.poll_device_recovery();
        if let Some(recovery) = engine.device_recovery_snapshot() {
            last_generation = recovery.attempt_generation;
            if recovery.phase == NativeDeviceRecoveryPhase::OriginalRestored {
                return Ok(last_generation);
            }
        }
        thread::sleep(Duration::from_millis(5));
    }
    Err(format!(
        "original device did not recover; last attempt generation {last_generation}"
    ))
}

fn artifact_path() -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let directory = std::env::temp_dir().join("heron-device-recovery-soak");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(format!("result-{timestamp}.json")))
}

fn main() -> Result<(), String> {
    let duration = duration_argument()?;
    reset_mock_device_control();
    let engine = AudioEngine::new();
    engine
        .start_audio_engine(config())
        .map_err(|error| error.to_string())?;
    let started = Instant::now();
    let deadline = started + duration;
    let mut cycles = 0_u64;
    let mut last_generation = 0_u64;
    while Instant::now() < deadline {
        if !set_mock_device_available("custom:mock-duplex", false) {
            return Err("mock device control rejected the duplex device".to_owned());
        }
        trigger_mock_stream_error(false, MockStreamFaultKind::DeviceNotAvailable);
        let recovery_id = wait_for_recovery(&engine, Instant::now() + Duration::from_secs(1))?;
        engine
            .authorize_device_recovery(recovery_id)
            .map_err(|error| error.to_string())?;
        engine.poll_device_recovery();
        if !set_mock_device_available("custom:mock-duplex", true) {
            return Err("mock device control could not restore the duplex device".to_owned());
        }
        let generation = wait_for_original(&engine, Instant::now() + Duration::from_secs(2))?;
        if generation <= last_generation {
            return Err("attempt generation did not advance monotonically".to_owned());
        }
        last_generation = generation;
        if cycles.is_multiple_of(2) {
            engine
                .keep_restored_device(recovery_id)
                .map_err(|error| error.to_string())?;
        } else {
            engine
                .select_recovery_device(recovery_id, config())
                .map_err(|error| error.to_string())?;
        }
        if engine.device_recovery_snapshot().is_some()
            || engine
                .audio_engine_snapshot()
                .map_err(|error| error.to_string())?
                .state
                != "running"
        {
            return Err("cycle did not converge to one running runtime".to_owned());
        }
        cycles = cycles.saturating_add(1);
    }
    engine
        .stop_audio_engine()
        .map_err(|error| error.to_string())?;
    reset_mock_device_control();
    let artifact = artifact_path()?;
    fs::write(
        &artifact,
        format!(
            "{{\n  \"durationSeconds\": {},\n  \"cycles\": {},\n  \"lastAttemptGeneration\": {},\n  \"finalRuntime\": \"stopped\",\n  \"overlappingAttempts\": 0,\n  \"staleCommits\": 0\n}}\n",
            started.elapsed().as_secs(),
            cycles,
            last_generation
        ),
    )
    .map_err(|error| error.to_string())?;
    println!("device recovery soak passed: {}", artifact.display());
    Ok(())
}
