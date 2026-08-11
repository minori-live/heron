use super::{
    ControlResult, EmbeddedUiHost, HostEvent, PluginFailureCategory, PluginFailureOutcome,
    PluginFailureStage, PluginProcessFailure, PluginRuntimeFailure, std_mpsc,
};

impl EmbeddedUiHost {
    pub(in crate::runtime) fn poll_plugin_process_failures(&self) {
        let failures = self.processors.lock().map_or_else(
            |_| Vec::new(),
            |processors| {
                processors
                    .iter()
                    .filter_map(|(instance_id, processor)| {
                        processor
                            .take_unreported_process_failure()
                            .map(|failure| (instance_id.clone(), processor.clone(), failure))
                    })
                    .collect::<Vec<_>>()
            },
        );
        for (instance_id, processor, report) in failures {
            let (category, message) = match report.failure {
                PluginProcessFailure::Rejected => (
                    PluginFailureCategory::PluginRejected,
                    "the plug-in rejected an audio processing block",
                ),
                PluginProcessFailure::InvalidOutput => (
                    PluginFailureCategory::InvalidOutput,
                    "the plug-in produced non-finite audio",
                ),
            };
            let diagnostic_id = format!("plugin:{instance_id}:process");
            if matches!(
                self.host_events.try_send(HostEvent::PluginFailure {
                    failure: PluginRuntimeFailure {
                        instance_id,
                        instance_generation: report.instance_generation,
                        graph_revision: report.graph_revision,
                        category,
                        stage: PluginFailureStage::Process,
                        outcome: PluginFailureOutcome::Failed,
                        recoverable: true,
                        diagnostic_id,
                        message: message.to_owned(),
                    },
                }),
                Err(std_mpsc::TrySendError::Full(_))
            ) {
                processor.make_process_failure_reportable();
            }
        }
    }

    pub(super) fn poll_ara_callbacks(&mut self) {
        self.flush_pending_ara_events();
        let include_model_events = self.pending_ara_events.is_empty();
        let batches = self
            .vst3
            .as_mut()
            .map(|runtime| runtime.poll_ara_callbacks(include_model_events))
            .unwrap_or_default();
        for batch in batches {
            for (sequence, event) in batch.events {
                self.pending_ara_events.push_back(HostEvent::AraCallback {
                    instance_id: batch.instance_id.clone(),
                    sequence,
                    event,
                });
            }
            for command in batch.transport {
                let result =
                    match command {
                        crate::ara::AraTransportCommand::Play => self
                            .audio_engine
                            .transport_command("play".to_owned(), None, None, None, None),
                        crate::ara::AraTransportCommand::Pause => self
                            .audio_engine
                            .transport_command("pause".to_owned(), None, None, None, None),
                        crate::ara::AraTransportCommand::SeekFrames(position) => self
                            .audio_engine
                            .transport_command("seek".to_owned(), Some(position), None, None, None),
                        crate::ara::AraTransportCommand::SetLoop {
                            enabled,
                            start_tick,
                            end_tick,
                        } => self.audio_engine.transport_command(
                            "set-loop".to_owned(),
                            None,
                            Some(enabled),
                            Some(start_tick),
                            Some(end_tick),
                        ),
                    };
                if let Err(error) = result {
                    self.publish_ara_runtime_failure(&batch.instance_id, error);
                }
            }
            for failure in batch.failures {
                self.publish_ara_runtime_failure(&batch.instance_id, failure);
            }
        }
        self.flush_pending_ara_events();
    }

    pub(super) fn flush_pending_ara_events(&mut self) {
        while let Some(event) = self.pending_ara_events.pop_front() {
            match self.host_events.try_send(event) {
                Ok(()) => {}
                Err(std_mpsc::TrySendError::Full(event)) => {
                    self.pending_ara_events.push_front(event);
                    break;
                }
                Err(std_mpsc::TrySendError::Disconnected(_)) => {
                    self.pending_ara_events.clear();
                    break;
                }
            }
        }
    }

    pub(super) fn publish_ara_runtime_failure(
        &self,
        instance_id: &str,
        diagnostic: impl std::fmt::Display,
    ) {
        self.publish_plugin_runtime_failure(instance_id, "ara-playback-callback", diagnostic);
    }

    pub(super) fn publish_plugin_runtime_failure(
        &self,
        instance_id: &str,
        phase: &str,
        diagnostic: impl std::fmt::Display,
    ) {
        if let ControlResult::Error { error } = crate::control_error_result(diagnostic) {
            let _ = self.host_events.try_send(HostEvent::RuntimeFailure {
                error,
                plugin_instance_id: Some(instance_id.to_owned()),
                phase: Some(phase.to_owned()),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::ui_runtime::test_support::{FixtureFailure, host, processor};

    fn insert_failed_processor(host: &EmbeddedUiHost, failure: FixtureFailure) {
        host.processors
            .lock()
            .expect("processor registry should be available")
            .insert("plugin-1".to_owned(), processor(Some(failure)));
    }

    fn assert_process_failure(
        event: HostEvent,
        expected_category: PluginFailureCategory,
        expected_message: &str,
    ) {
        let HostEvent::PluginFailure { failure } = event else {
            panic!("expected a plug-in failure event");
        };
        assert_eq!(failure.instance_id, "plugin-1");
        assert_eq!(failure.instance_generation, 7);
        assert_eq!(failure.graph_revision, 11);
        assert_eq!(failure.category, expected_category);
        assert_eq!(failure.stage, PluginFailureStage::Process);
        assert_eq!(failure.outcome, PluginFailureOutcome::Failed);
        assert!(failure.recoverable);
        assert_eq!(failure.diagnostic_id, "plugin:plugin-1:process");
        assert_eq!(failure.message, expected_message);
    }

    #[test]
    fn process_rejections_publish_one_typed_failure() {
        let (host, events) = host(1);
        insert_failed_processor(&host, FixtureFailure::Rejected);

        host.poll_plugin_process_failures();

        assert_process_failure(
            events.recv().expect("failure event should be published"),
            PluginFailureCategory::PluginRejected,
            "the plug-in rejected an audio processing block",
        );
        host.poll_plugin_process_failures();
        assert!(events.try_recv().is_err());
    }

    #[test]
    fn invalid_output_publishes_the_captured_generation_and_revision() {
        let (host, events) = host(1);
        insert_failed_processor(&host, FixtureFailure::InvalidOutput);

        host.poll_plugin_process_failures();

        assert_process_failure(
            events.recv().expect("failure event should be published"),
            PluginFailureCategory::InvalidOutput,
            "the plug-in produced non-finite audio",
        );
    }

    #[test]
    fn a_full_event_queue_makes_the_process_failure_reportable_again() {
        let (host, events) = host(1);
        host.host_events
            .try_send(HostEvent::Ready)
            .expect("test queue should accept its sentinel");
        insert_failed_processor(&host, FixtureFailure::Rejected);

        host.poll_plugin_process_failures();
        assert_eq!(
            events.recv().expect("sentinel should remain queued"),
            HostEvent::Ready
        );
        host.poll_plugin_process_failures();

        assert_process_failure(
            events.recv().expect("failure should be retried"),
            PluginFailureCategory::PluginRejected,
            "the plug-in rejected an audio processing block",
        );
    }

    #[test]
    fn pending_ara_events_preserve_order_across_full_and_disconnected_queues() {
        let (mut host, events) = host(1);
        host.host_events
            .try_send(HostEvent::Ready)
            .expect("test queue should accept its sentinel");
        host.pending_ara_events
            .push_back(HostEvent::GraphPublished { revision: 9 });

        host.flush_pending_ara_events();
        assert_eq!(host.pending_ara_events.len(), 1);
        assert_eq!(
            events.recv().expect("sentinel should remain queued"),
            HostEvent::Ready
        );
        host.flush_pending_ara_events();
        assert_eq!(
            events.recv().expect("pending event should be published"),
            HostEvent::GraphPublished { revision: 9 }
        );

        host.pending_ara_events.push_back(HostEvent::Ready);
        drop(events);
        host.flush_pending_ara_events();
        assert!(host.pending_ara_events.is_empty());
    }

    #[test]
    fn ara_runtime_failures_keep_instance_and_phase_context() {
        let (host, events) = host(1);

        host.publish_ara_runtime_failure("ara-1", "transport rejected");

        let HostEvent::RuntimeFailure {
            plugin_instance_id,
            phase,
            ..
        } = events.recv().expect("runtime failure should be published")
        else {
            panic!("expected a runtime failure event");
        };
        assert_eq!(plugin_instance_id.as_deref(), Some("ara-1"));
        assert_eq!(phase.as_deref(), Some("ara-playback-callback"));
    }
}
