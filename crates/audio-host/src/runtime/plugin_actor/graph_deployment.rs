use super::{
    ActorRequest, ControlResult, GraphTransactionRequest, GraphTransactionState,
    GraphTransactionValue, HashMap, LiveMixerGraph, MIDI_INPUT, Mutex, RpcRequestMeta, engine,
    graph_busy_error, graph_correlation, graph_dependency_error, graph_failure, graph_success,
    graph_timeout_error, graph_validation_error, mpsc, publish_built_graph, validate_graph_request,
    vst3, wait_for_graph_build_publication,
};

/// Runtime restoration may rebuild the committed revision after a stream restart,
/// but it must not replace the document graph or resolve another operation.
pub(super) struct CommittedGraphRestoration<'a> {
    pub(super) transactions: &'a mut GraphTransactionState,
    pub(super) audio_engine: &'a engine::AudioEngine,
    pub(super) engine_sender: &'a mpsc::Sender<ActorRequest>,
    pub(super) graph_build_gate: &'a tokio::sync::Mutex<()>,
    pub(super) processors: &'a Mutex<HashMap<String, vst3::AudioPluginProcessorHandle>>,
}

impl CommittedGraphRestoration<'_> {
    pub(super) async fn restore(
        self,
        meta: &RpcRequestMeta,
        request: &GraphTransactionRequest,
    ) -> ControlResult {
        let validated = match validate_graph_request(
            meta,
            request,
            &self.transactions.helper_epoch,
            self.transactions.committed_revision,
        ) {
            Ok(validated) => validated,
            Err(error) => return graph_failure(meta, error),
        };
        self.transactions.observe_engine(validated.engine);
        let state = &*self.transactions;
        if let Some(candidate) = &state.candidate {
            return graph_failure(
                meta,
                graph_busy_error(meta, Some(candidate.operation_id.clone())),
            );
        }
        if state.committed_revision == 0 && state.committed_project_graph.is_none() {
            return self.snapshot(meta);
        }
        if state.committed_project_graph.as_ref() != Some(&request.project_graph) {
            return graph_failure(meta, graph_validation_error(meta, "projectGraph"));
        }
        let _build_guard = self.graph_build_gate.lock().await;
        let processors = match self.processors.lock() {
            Ok(processors) => processors.clone(),
            Err(error) => return self.failure(meta, "restore-processors", &error, request),
        };
        // A failed candidate temporarily installs its own endpoints for compilation.
        // Restoration must use the still-active instances after candidate cleanup.
        self.audio_engine.set_plugin_processors(processors);
        let input = match self
            .audio_engine
            .begin_committed_graph_restoration(state.committed_revision)
        {
            Ok(input) => input,
            Err(error) => return self.failure(meta, "restore-begin", &error, request),
        };
        let built = match crate::graph_compilation::compile(input).await {
            Ok(built) => built,
            Err(error) => return self.failure(meta, "restore-compile", &error, request),
        };
        let build_generation = built.build_generation();
        match publish_built_graph(self.engine_sender, built).await {
            ControlResult::Accepted => {
                if wait_for_graph_build_publication(
                    self.audio_engine,
                    state.committed_revision,
                    build_generation,
                )
                .await
                {
                    self.snapshot(meta)
                } else {
                    graph_failure(meta, graph_timeout_error(meta))
                }
            }
            ControlResult::Error { error } => {
                self.failure(meta, "restore-publish", &error.correlation_id, request)
            }
            _ => self.failure(
                meta,
                "restore-publish",
                &"unexpected engine actor result",
                request,
            ),
        }
    }

    fn snapshot(&self, meta: &RpcRequestMeta) -> ControlResult {
        graph_success(
            meta,
            self.transactions.committed_revision,
            GraphTransactionValue::Snapshot {
                snapshot: self.transactions.snapshot_with_engine(self.audio_engine),
            },
        )
    }

    fn failure(
        &self,
        meta: &RpcRequestMeta,
        phase: &str,
        error: &dyn std::fmt::Display,
        request: &GraphTransactionRequest,
    ) -> ControlResult {
        log_graph_transaction_failure(meta, phase, error);
        graph_failure(
            meta,
            graph_dependency_error(meta, request.project_graph.clone()),
        )
    }
}

pub(super) fn update_graph_midi_routes(graph: &LiveMixerGraph) {
    let Some(midi_input) = MIDI_INPUT.get() else {
        return;
    };
    let mut all_inputs = false;
    let port_ids = graph
        .channels
        .iter()
        .filter(|channel| {
            channel.kind == "instrument"
                && channel.system_role.is_none()
                && (channel.input_monitoring || channel.record_armed)
        })
        .filter_map(|channel| {
            if let Some(port_id) = &channel.midi_input_port_id {
                Some(port_id.clone())
            } else {
                all_inputs = true;
                None
            }
        })
        .collect();
    midi_input.update_routes(all_inputs, port_ids);
}

pub(super) fn log_graph_transaction_failure(
    meta: &RpcRequestMeta,
    phase: &str,
    error: &dyn std::fmt::Display,
) {
    eprintln!(
        "audio-host graph transaction [{}] {phase} failed: {error}",
        graph_correlation(meta, phase)
    );
}
