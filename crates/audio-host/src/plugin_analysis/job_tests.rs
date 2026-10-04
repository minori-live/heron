use super::{Job, PluginAnalysisJobs, failed};
use heron_audio_plugin::{
    AudioPluginProcessor, AudioPluginProcessorHandle, ProcessContext, SidechainSource,
};
use heron_dsp_runtime::protocol::{
    PluginAnalysisFailure, PluginAnalysisJobStatus, PluginAnalysisSettings,
};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    time::{Duration, Instant},
};

fn settings() -> PluginAnalysisSettings {
    PluginAnalysisSettings {
        sample_rate: 48000,
        block_size: 256,
        level_dbfs: -6.0,
        start_hz: 100.0,
        end_hz: 12000.0,
        sweep_seconds: 1.0,
        tail_seconds: 0.25,
    }
}

fn terminal_status(jobs: &PluginAnalysisJobs, id: &str) -> PluginAnalysisJobStatus {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let status = jobs.status(id, false, false);
        if !matches!(status, PluginAnalysisJobStatus::Running { .. }) {
            return status;
        }
        assert!(Instant::now() < deadline, "analysis {id} did not finish");
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[derive(Clone)]
struct GatedProcessor {
    entered: Sender<()>,
    resume: Arc<Mutex<Receiver<()>>>,
    retired: Arc<AtomicUsize>,
}

impl AudioPluginProcessor for GatedProcessor {
    fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
        Box::new(self.clone())
    }

    fn process_block(
        &mut self,
        _: &mut [[f32; 2]],
        _: &dyn SidechainSource,
        _: &ProcessContext,
    ) -> bool {
        self.entered.send(()).unwrap();
        // A failed assertion must not leave the job's Drop waiting forever.
        self.resume
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .is_ok()
    }

    fn retire(&mut self) {
        self.retired.fetch_add(1, Ordering::AcqRel);
    }
}

#[test]
fn cancel_keeps_the_job_owned_until_worker_retirement_and_explicit_release() {
    let jobs = PluginAnalysisJobs::default();
    let (entered, processing) = mpsc::channel();
    let (resume, receiver) = mpsc::channel();
    let retired = Arc::new(AtomicUsize::new(0));
    let processor = GatedProcessor {
        entered,
        resume: Arc::new(Mutex::new(receiver)),
        retired: Arc::clone(&retired),
    };
    assert!(matches!(
        jobs.start(
            "owned".into(),
            vec![AudioPluginProcessorHandle::new(processor)],
            settings(),
            0,
        ),
        PluginAnalysisJobStatus::Running { .. }
    ));
    processing.recv_timeout(Duration::from_secs(5)).unwrap();

    let running = jobs.status("owned", false, false);
    // Replaying the same operation returns its status, even with a different payload.
    assert_eq!(jobs.start("owned".into(), vec![], settings(), 0), running);
    assert_eq!(jobs.status("owned", true, true), running);
    assert_eq!(jobs.status("owned", false, false), running);
    assert_eq!(retired.load(Ordering::Acquire), 0);
    assert_eq!(
        jobs.start("other".into(), vec![], settings(), 0),
        failed(PluginAnalysisFailure::Busy)
    );

    resume.send(()).unwrap();
    let cancelled = failed(PluginAnalysisFailure::Cancelled);
    assert_eq!(terminal_status(&jobs, "owned"), cancelled);
    assert_eq!(retired.load(Ordering::Acquire), 1);
    assert_eq!(jobs.status("owned", false, true), cancelled);
    assert_eq!(
        jobs.status("owned", true, true),
        failed(PluginAnalysisFailure::MissingJob)
    );
}

#[derive(Clone)]
struct MatrixProcessor;

impl AudioPluginProcessor for MatrixProcessor {
    fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
        Box::new(self.clone())
    }

    fn process_block(
        &mut self,
        frames: &mut [[f32; 2]],
        _: &dyn SidechainSource,
        _: &ProcessContext,
    ) -> bool {
        for frame in frames {
            *frame = [frame[0] * 0.5, frame[0] * 0.25 + frame[1]];
        }
        true
    }
}

#[test]
fn completed_stereo_report_preserves_routing_and_rejects_a_cross_channel_model() {
    let jobs = PluginAnalysisJobs::default();
    let settings = settings();
    jobs.start(
        "matrix".into(),
        vec![AudioPluginProcessorHandle::new(MatrixProcessor)],
        settings.clone(),
        0,
    );
    let completed = terminal_status(&jobs, "matrix");
    let PluginAnalysisJobStatus::Completed { report } = &completed else {
        panic!("expected a completed report, got {completed:?}");
    };
    assert_eq!(report.settings, settings);
    assert_eq!(report.responses.len(), 4);
    for (input, output, gain_db) in [(0, 0, -6.0206), (0, 1, -12.0412), (1, 1, 0.0)] {
        let response = report
            .responses
            .iter()
            .find(|response| response.input == input && response.output == output)
            .unwrap();
        assert!(
            response
                .magnitude_db
                .iter()
                .all(|db| (db - gain_db).abs() < 0.05)
        );
        assert_eq!(response.delay_samples, Some(0));
        assert_eq!(response.silence_rms, 0.0);
        assert_eq!(response.repeat_error_percent, 0.0);
        assert!(!response.tail_truncated);
    }
    let silent = report
        .responses
        .iter()
        .find(|response| response.input == 1 && response.output == 0)
        .unwrap();
    assert!(silent.magnitude_db.iter().all(|db| *db <= -120.0));
    assert!(silent.phase_degrees.iter().all(Option::is_none));

    assert_eq!(
        report
            .models
            .iter()
            .map(|model| model.channel)
            .collect::<Vec<_>>(),
        [0, 1]
    );
    for model in &report.models {
        // Both direct paths are linear and fit well. Only the left input also
        // drives another output, which makes its independent SISO model unsafe.
        assert!(model.validation_error_percent < 1.0);
        assert_eq!(model.suitable, model.channel == 1);
    }
    assert_eq!(
        report
            .spectrograms
            .iter()
            .map(|spectrum| (spectrum.channel, spectrum.logarithmic_sweep))
            .collect::<Vec<_>>(),
        [(0, true), (0, false), (1, true), (1, false)]
    );
    for spectrum in &report.spectrograms {
        assert_eq!(
            spectrum.magnitude_dbfs.len(),
            (spectrum.rows * spectrum.columns) as usize
        );
        assert!(spectrum.magnitude_dbfs.iter().all(|db| db.is_finite()));
        assert!(spectrum.magnitude_dbfs.iter().any(|db| *db > -30.0));
    }
    assert_eq!(
        report
            .harmonics
            .iter()
            .map(|harmonics| harmonics.channel)
            .collect::<Vec<_>>(),
        [0, 1]
    );
    for harmonics in &report.harmonics {
        assert!(
            harmonics
                .thd_percent
                .iter()
                .flatten()
                .all(|thd| *thd < 0.001)
        );
    }
    let performance = &report.performance;
    assert_eq!(performance.reported_latency_samples, 0);
    assert_eq!(
        performance.measured_blocks,
        4 * 60000_usize.div_ceil(256) as u32
    );
    assert_eq!(performance.budget_us, 256.0 / 48000.0 * 1e6);
    assert!(performance.average_block_us <= performance.maximum_block_us);
    assert!(performance.p95_block_us <= performance.p99_block_us);
    assert!(performance.p99_block_us <= performance.maximum_block_us);
    assert!(performance.deadline_misses <= performance.measured_blocks);

    assert_eq!(jobs.start("matrix".into(), vec![], settings, 0), completed);
    assert_eq!(
        jobs.start("next".into(), vec![], self::settings(), 0),
        failed(PluginAnalysisFailure::Busy)
    );
    assert_eq!(jobs.status("matrix", false, true), completed);
    assert_eq!(
        jobs.status("matrix", false, false),
        failed(PluginAnalysisFailure::MissingJob)
    );
}

#[derive(Clone)]
struct RejectingProcessor;

impl AudioPluginProcessor for RejectingProcessor {
    fn clone_box(&self) -> Box<dyn AudioPluginProcessor> {
        Box::new(self.clone())
    }

    fn process_block(
        &mut self,
        _: &mut [[f32; 2]],
        _: &dyn SidechainSource,
        _: &ProcessContext,
    ) -> bool {
        false
    }
}

#[test]
fn invalid_settings_do_not_reserve_the_id_and_a_rejected_processor_can_be_released() {
    let jobs = PluginAnalysisJobs::default();
    let mut invalid = settings();
    invalid.block_size = 0;
    for (settings, latency) in [(invalid, 0), (settings(), 12000)] {
        assert_eq!(
            jobs.start("retry".into(), vec![], settings, latency),
            failed(PluginAnalysisFailure::InvalidSettings)
        );
        assert_eq!(
            jobs.status("retry", false, false),
            failed(PluginAnalysisFailure::MissingJob)
        );
    }
    assert!(matches!(
        jobs.start(
            "retry".into(),
            vec![AudioPluginProcessorHandle::new(RejectingProcessor)],
            settings(),
            0,
        ),
        PluginAnalysisJobStatus::Running { .. }
    ));
    let rejected = failed(PluginAnalysisFailure::ProcessorRejected);
    assert_eq!(terminal_status(&jobs, "retry"), rejected);
    assert_eq!(jobs.status("retry", false, true), rejected);
    assert_eq!(
        jobs.status("retry", false, false),
        failed(PluginAnalysisFailure::MissingJob)
    );
}

#[test]
fn a_worker_exit_without_a_terminal_result_is_reconciled_before_release() {
    let jobs = PluginAnalysisJobs::default();
    // Reproduce a worker that exited before publishing its result, without
    // depending on a plug-in SDK or inducing a process panic in the fixture.
    let worker = std::thread::spawn(|| {});
    let deadline = Instant::now() + Duration::from_secs(5);
    while !worker.is_finished() {
        assert!(Instant::now() < deadline, "fixture worker did not exit");
        std::thread::sleep(Duration::from_millis(1));
    }
    jobs.jobs.lock().unwrap().insert(
        "lost".into(),
        Job {
            cancel: Arc::new(AtomicBool::new(false)),
            status: Arc::new(Mutex::new(PluginAnalysisJobStatus::Running {
                phase: "linear".into(),
                progress: 0.0,
            })),
            worker,
        },
    );
    let unavailable = failed(PluginAnalysisFailure::WorkerUnavailable);
    assert_eq!(jobs.status("lost", false, false), unavailable);
    assert_eq!(
        jobs.start("lost".into(), vec![], settings(), 0),
        unavailable
    );
    assert_eq!(jobs.status("lost", false, true), unavailable);
    assert_eq!(
        jobs.status("lost", false, false),
        failed(PluginAnalysisFailure::MissingJob)
    );
}
