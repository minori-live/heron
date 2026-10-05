//! Candidate ownership and retirement for transactional VST3 graph replacement.

use super::failures::{diagnostic_rpc_error, plugin_rpc_error};
use super::{
    AudioPluginProcessorHandle, ControlResult, GuardedInstance, HashMap, LiveMixerGraph,
    LoadPluginRequest, PluginAuxInputConfiguration, Vst3Runtime,
};
use heron_dsp_runtime::protocol::{PluginFailureStage, RpcError};

impl Vst3Runtime {
    pub fn prepare_graph_instances(
        &mut self,
        operation_id: &str,
        graph: &LiveMixerGraph,
    ) -> Result<(), Box<RpcError>> {
        if self.rollback_graph_instances.contains_key(operation_id) {
            return Err(Box::new(diagnostic_rpc_error(
                None,
                PluginFailureStage::Initialize,
                "prepare graph instances",
                "plugin graph activation is already in progress",
            )));
        }
        self.abort_graph_instances(operation_id);
        let mut staged = HashMap::new();
        for plugin in &graph.plugins {
            let mut desired = plugin
                .aux_input_buses
                .iter()
                .filter(|bus| bus.source_channel_id.is_some())
                .map(|bus| PluginAuxInputConfiguration {
                    input_port_key: bus.input_port_key.clone(),
                    channels: bus.channels,
                })
                .collect::<Vec<_>>();
            desired.sort_by(|left, right| left.input_port_key.cmp(&right.input_port_key));
            let Some(current) = self.instances.get_mut(&plugin.instance_id) else {
                continue;
            };
            let mut current_aux = current.aux_input_configs.clone();
            current_aux.sort_by(|left, right| left.input_port_key.cmp(&right.input_port_key));
            if current_aux == desired {
                continue;
            }
            let (component_state, controller_state) =
                current.plugin.save_state().map_err(|error| {
                    plugin_rpc_error(
                        Some(&plugin.instance_id),
                        PluginFailureStage::StateSave,
                        &error,
                    )
                })?;
            let ara_document_state = match &mut current.ara {
                Some(ara) => current
                    .plugin
                    .with_processing_paused(|| ara.save_archive())
                    .map_err(|error| {
                        diagnostic_rpc_error(
                            Some(&plugin.instance_id),
                            PluginFailureStage::Ara,
                            "save ARA archive for graph candidate",
                            error,
                        )
                    })?,
                None => current.ara_document_state.clone(),
            };
            let mut configuration = current.configuration.clone();
            configuration.component_state = component_state.clone();
            configuration.controller_state = controller_state.clone();
            configuration.ara_document_state = ara_document_state.clone();
            configuration.active_aux_inputs = desired.clone();
            let runtime_handle = current.runtime_handle;
            let request = LoadPluginRequest {
                instance_id: plugin.instance_id.clone(),
                module_path: configuration.module_path.clone(),
                class_id: configuration.class_id.clone(),
                plugin_kind: configuration.plugin_kind.clone(),
                audio_mode: configuration.audio_mode,
                active_aux_inputs: desired,
                sample_rate: f64::from_bits(configuration.sample_rate_bits),
                component_state,
                controller_state,
                ara_factory_class_id: configuration.ara_factory_class_id.clone(),
                ara_document_state,
            };
            let old = self.instances.remove(&plugin.instance_id).ok_or_else(|| {
                diagnostic_rpc_error(
                    Some(&plugin.instance_id),
                    PluginFailureStage::Initialize,
                    "prepare graph instances",
                    "plug-in disappeared while staging its side-chain buses",
                )
            })?;
            let result = self.load_plugin(request);
            let candidate = if matches!(result, ControlResult::PluginLoaded { .. }) {
                self.instances.remove(&plugin.instance_id)
            } else {
                None
            };
            self.instances.insert(plugin.instance_id.clone(), old);
            let Some(mut candidate) = candidate else {
                drop(staged);
                return Err(Box::new(match result {
                    ControlResult::Error { error } => error,
                    _ => diagnostic_rpc_error(
                        Some(&plugin.instance_id),
                        PluginFailureStage::Initialize,
                        "prepare graph instances",
                        "could not create the candidate side-chain plug-in instance",
                    ),
                }));
            };
            candidate.runtime_handle = runtime_handle;
            staged.insert(plugin.instance_id.clone(), candidate);
        }
        self.staged_graph_instances
            .insert(operation_id.to_owned(), staged);
        Ok(())
    }

    pub fn graph_processor_handles(
        &self,
        operation_id: &str,
    ) -> HashMap<String, AudioPluginProcessorHandle> {
        let staged = self.staged_graph_instances.get(operation_id);
        self.instances
            .iter()
            .map(|(id, instance)| {
                let instance = staged.and_then(|values| values.get(id)).unwrap_or(instance);
                (id.clone(), instance.processor_handle())
            })
            .collect()
    }

    pub fn activate_graph_instances(
        &mut self,
        operation_id: &str,
    ) -> Result<Vec<String>, Box<RpcError>> {
        let staged = self
            .staged_graph_instances
            .get(operation_id)
            .ok_or_else(|| {
                diagnostic_rpc_error(
                    None,
                    PluginFailureStage::Initialize,
                    "activate graph instances",
                    "plugin graph candidate was not prepared",
                )
            })?;
        // Validate the whole swap before moving any instances out of the prepared state.
        if let Some(id) = staged.keys().find(|id| !self.instances.contains_key(*id)) {
            return Err(Box::new(diagnostic_rpc_error(
                Some(id),
                PluginFailureStage::Initialize,
                "activate graph instances",
                "active VST3 instance is missing",
            )));
        }
        let staged = self
            .staged_graph_instances
            .remove(operation_id)
            .ok_or_else(|| {
                diagnostic_rpc_error(
                    None,
                    PluginFailureStage::Initialize,
                    "activate graph instances",
                    "plugin graph candidate was not prepared",
                )
            })?;
        let mut rollback = HashMap::with_capacity(staged.len());
        let mut changed = Vec::with_capacity(staged.len());
        for (id, candidate) in staged {
            let old = self
                .instances
                .insert(id.clone(), candidate)
                .expect("the complete swap was validated before moving instances");
            rollback.insert(id.clone(), old);
            changed.push(id);
        }
        self.rollback_graph_instances
            .insert(operation_id.to_owned(), rollback);
        Ok(changed)
    }

    pub fn finish_graph_instances(&mut self, operation_id: &str) {
        if let Some(previous) = self.rollback_graph_instances.remove(operation_id) {
            for (instance_id, instance) in previous {
                if instance.has_outstanding_processor_leases() {
                    self.retired_instances.push(GuardedInstance {
                        instance_id,
                        instance,
                    });
                } else {
                    self.finish_unload(&instance_id, instance);
                }
            }
        }
    }

    pub fn rollback_graph_instances(&mut self, operation_id: &str) -> Vec<String> {
        let Some(previous) = self.rollback_graph_instances.remove(operation_id) else {
            return Vec::new();
        };
        let mut changed = Vec::with_capacity(previous.len());
        for (id, old) in previous {
            if let Some(candidate) = self.instances.insert(id.clone(), old)
                && candidate.has_outstanding_processor_leases()
            {
                self.retired_instances.push(GuardedInstance {
                    instance_id: id.clone(),
                    instance: candidate,
                });
            }
            changed.push(id);
        }
        changed
    }

    pub fn abort_graph_instances(&mut self, operation_id: &str) {
        if let Some(staged) = self.staged_graph_instances.remove(operation_id) {
            for (instance_id, instance) in staged {
                if instance.has_outstanding_processor_leases() {
                    self.retired_instances.push(GuardedInstance {
                        instance_id,
                        instance,
                    });
                } else {
                    self.finish_unload(&instance_id, instance);
                }
            }
        }
    }
}
