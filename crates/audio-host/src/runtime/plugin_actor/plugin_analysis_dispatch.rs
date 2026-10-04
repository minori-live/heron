use crate::plugin_analysis::{PluginAnalysisJobs, failed};
use heron_audio_plugin::AudioPluginProcessorHandle;
use heron_dsp_runtime::protocol::{ControlCommand, ControlResult, PluginAnalysisFailure};
use std::{collections::HashMap, sync::Mutex};

pub(super) fn dispatch(
    command: ControlCommand,
    processors: &Mutex<HashMap<String, AudioPluginProcessorHandle>>,
    jobs: &PluginAnalysisJobs,
) -> ControlResult {
    match command {
        ControlCommand::StartPluginAnalysis {
            operation_id,
            instance_ids,
            comparison_instance_ids,
            settings,
            reported_latency_samples,
        } => {
            let valid_ids = |ids: &[String]| {
                ids.len() <= 16
                    && ids.iter().enumerate().all(|(index, id)| {
                        id.starts_with("plugin-analysis-measure-") && !ids[..index].contains(id)
                    })
            };
            let groups = processors.lock().ok().and_then(|slots| {
                if !valid_ids(&instance_ids)
                    || comparison_instance_ids.as_ref().is_some_and(|ids| {
                        !valid_ids(ids) || ids.iter().any(|id| instance_ids.contains(id))
                    })
                {
                    return None;
                }
                let primary = instance_ids
                    .iter()
                    .map(|id| slots.get(id).cloned())
                    .collect::<Option<Vec<_>>>()?;
                let comparison = match comparison_instance_ids {
                    Some(ids) => Some(
                        ids.iter()
                            .map(|id| slots.get(id).cloned())
                            .collect::<Option<Vec<_>>>()?,
                    ),
                    None => None,
                };
                Some((primary, comparison))
            });
            let status = match groups {
                Some((slots, comparison)) => jobs.start(
                    operation_id,
                    slots,
                    comparison,
                    settings,
                    reported_latency_samples,
                ),
                None => crate::plugin_analysis::failed(
                    heron_dsp_runtime::protocol::PluginAnalysisFailure::MissingProcessor,
                ),
            };
            ControlResult::PluginAnalysis {
                plugin_analysis_status: status,
            }
        }
        ControlCommand::PluginAnalysisStatus { operation_id } => ControlResult::PluginAnalysis {
            plugin_analysis_status: jobs.status(&operation_id, false, false),
        },
        ControlCommand::CancelPluginAnalysis { operation_id } => ControlResult::PluginAnalysis {
            plugin_analysis_status: jobs.status(&operation_id, true, false),
        },
        ControlCommand::ReleasePluginAnalysis { operation_id } => ControlResult::PluginAnalysis {
            plugin_analysis_status: jobs.status(&operation_id, false, true),
        },
        _ => ControlResult::PluginAnalysis {
            plugin_analysis_status: failed(PluginAnalysisFailure::InvalidSettings),
        },
    }
}
