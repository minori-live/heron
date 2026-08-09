//! A mock cpal backend built on cpal's custom-host API.
//!
//! The mock backend presents a fully functional audio host that never touches
//! real hardware. Selecting it is the equivalent of disabling CoreAudio in Logic
//! Pro: the engine, transport, mixer graph, and plugins all run, but capture is
//! synthesised and playback is discarded. That makes it useful for three
//! situations:
//!
//! - Debugging the engine without a physical device holding the driver open.
//! - Deterministic automated tests and headless CI where no driver exists.
//! - Running the application on machines with no usable audio hardware.
//!
//! Because it is a real [`cpal`] host rather than a bespoke worker loop, the
//! engine drives it through exactly the same device enumeration, stream
//! building, resampling, metering, and recording code paths as WASAPI, ASIO,
//! CoreAudio, or ALSA.
//!
//! Playback is looped back into capture, so features that depend on hearing the
//! engine's own output — most notably round-trip latency measurement — behave as
//! they would with a physical loopback cable. Devices are exposed under cpal's
//! `custom` host, so their identifiers carry a `custom:` prefix, for example
//! `custom:mock-duplex`.

use std::{
    fmt,
    hash::{Hash, Hasher},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use cpal::{
    BufferSize, ChannelCount, Data, DeviceDescription, DeviceDescriptionBuilder, DeviceDirection,
    DeviceId, DeviceType, Error, ErrorKind, FrameCount, Host, HostId, InputCallbackInfo,
    InputStreamTimestamp, InterfaceType, OutputCallbackInfo, OutputStreamTimestamp, SampleFormat,
    SampleRate, StreamConfig, StreamInstant, SupportedBufferSize, SupportedStreamConfig,
    SupportedStreamConfigRange,
    platform::CustomHost,
    traits::{DeviceTrait, HostTrait, StreamTrait},
};
use ringbuf::{
    HeapCons, HeapProd, HeapRb,
    traits::{Consumer, Observer, Producer, Split},
};

mod device;
mod stream;

use device::{MockBackend, MockDeviceKind, MockHost};
use stream::MockStream;

/// The backend identifier accepted by [`crate::device`] and the audio engine.
pub const BACKEND_ID: &str = "mock";

/// The human-readable backend name shown in the audio device settings.
pub const BACKEND_LABEL: &str = "Mock";

/// The only sample rate the mock devices run at.
const SAMPLE_RATE: SampleRate = 48_000;

/// The channel count of every mock device, for both capture and playback.
const CHANNELS: ChannelCount = 2;

const MIN_BUFFER_FRAMES: FrameCount = 32;
const MAX_BUFFER_FRAMES: FrameCount = 2_048;
const DEFAULT_BUFFER_FRAMES: FrameCount = 256;

/// How far playback may run ahead of capture before the loopback drops frames.
///
/// The bound keeps measured loopback latency close to one block even when the
/// capture worker is descheduled for several blocks at a time.
const LOOPBACK_SLACK_BLOCKS: usize = 4;

const LOOPBACK_CAPACITY_FRAMES: usize = MAX_BUFFER_FRAMES as usize * (LOOPBACK_SLACK_BLOCKS + 1);

/// The sample format the mock devices exchange with the engine.
const SAMPLE_FORMAT: SampleFormat = SampleFormat::F32;

type LoopbackFrame = [f32; CHANNELS as usize];

#[cfg(any(test, feature = "test-support"))]
struct MockErrorSink {
    input: bool,
    sender: mpsc::SyncSender<ErrorKind>,
}

struct MockControl {
    available: Mutex<[bool; 3]>,
    #[cfg(any(test, feature = "test-support"))]
    error_sinks: Mutex<Vec<MockErrorSink>>,
}

impl MockControl {
    fn available(&self, kind: MockDeviceKind) -> bool {
        self.available
            .lock()
            .map(|available| available[kind.index()])
            .unwrap_or(false)
    }

    fn register_error_sink(&self, input: bool) -> mpsc::Receiver<ErrorKind> {
        let (sender, receiver) = mpsc::sync_channel(4);
        #[cfg(any(test, feature = "test-support"))]
        if let Ok(mut sinks) = self.error_sinks.lock() {
            sinks.push(MockErrorSink { input, sender });
        }
        #[cfg(not(any(test, feature = "test-support")))]
        let _ = (input, sender);
        receiver
    }
}

fn control() -> Arc<MockControl> {
    static CONTROL: OnceLock<Arc<MockControl>> = OnceLock::new();
    Arc::clone(CONTROL.get_or_init(|| {
        Arc::new(MockControl {
            available: Mutex::new([true; 3]),
            #[cfg(any(test, feature = "test-support"))]
            error_sinks: Mutex::new(Vec::new()),
        })
    }))
}

#[cfg(any(test, feature = "test-support"))]
pub fn set_mock_device_available(device_id: &str, available: bool) -> bool {
    let Some(kind) = MockDeviceKind::from_id(device_id) else {
        return false;
    };
    if let Ok(mut devices) = control().available.lock() {
        devices[kind.index()] = available;
        return true;
    }
    false
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MockStreamFaultKind {
    DeviceNotAvailable,
    StreamInvalidated,
    HostUnavailable,
    DeviceBusy,
    BackendError,
}

#[cfg(any(test, feature = "test-support"))]
pub fn trigger_mock_stream_error(input: bool, kind: MockStreamFaultKind) {
    let kind = match kind {
        MockStreamFaultKind::DeviceNotAvailable => ErrorKind::DeviceNotAvailable,
        MockStreamFaultKind::StreamInvalidated => ErrorKind::StreamInvalidated,
        MockStreamFaultKind::HostUnavailable => ErrorKind::HostUnavailable,
        MockStreamFaultKind::DeviceBusy => ErrorKind::DeviceBusy,
        MockStreamFaultKind::BackendError => ErrorKind::BackendError,
    };
    if let Ok(mut sinks) = control().error_sinks.lock() {
        sinks.retain(|sink| sink.input != input || sink.sender.try_send(kind).is_ok());
    }
}

#[cfg(any(test, feature = "test-support"))]
pub fn reset_mock_device_control() {
    let control = control();
    if let Ok(mut available) = control.available.lock() {
        *available = [true; 3];
    }
    if let Ok(mut sinks) = control.error_sinks.lock() {
        sinks.clear();
    }
}

/// Whether `backend` selects the mock backend.
///
/// Matching is case-insensitive to stay consistent with how cpal host
/// identifiers are compared elsewhere.
pub fn is_mock_backend(backend: &str) -> bool {
    backend.eq_ignore_ascii_case(BACKEND_ID)
}

/// Builds a cpal [`Host`] backed by the mock devices.
///
/// Each call produces an independent host with its own loopback, so streams
/// built from one host never observe audio from another.
pub fn host() -> Host {
    Host::from(CustomHost::from_host(MockHost::new()))
}

#[cfg(test)]
#[allow(clippy::wildcard_imports)]
mod tests;
