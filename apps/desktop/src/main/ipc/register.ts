import type { ApplicationServices, IpcHandlerContext } from "./context"
import { registerAudioHandlers } from "./audio-handlers"
import { registerBounceHandlers } from "./bounce-handlers"
import { registerDiagnosticHandlers } from "./diagnostic-handlers"
import { registerPluginAnalysisHandlers } from "./plugin-analysis-handlers"
import { registerMidiHandlers } from "./midi-handlers"
import { registerLowLatencyHandlers } from "./low-latency-handlers"
import { registerMixerHandlers } from "./mixer-handlers"
import { registerPluginHandlers } from "./plugin-handlers"
import { registerProjectHandlers } from "./project-handlers"
import { registerLiveHandlers } from "./live-handlers"
import { LiveDocumentCoordinator } from "./live-document-coordinator"
import { LivePerformanceSession } from "./live-performance-session"
import { registerRecordingHandlers } from "./recording-handlers"
import { registerSettingsRpcHandlers } from "./settings-rpc-handlers"
import { registerSystemHandlers } from "./system-handlers"
import { registerTransportHandlers } from "./transport-handlers"
import { sampleSystemPerformance } from "./support"
import { ProjectLifecycleService, synchronizePluginStatesAtomically } from "../project"
import { registerIpcEventPublishers, type DisposableRegistration } from "./event-publishers"

export function registerIpcHandlers(services: ApplicationServices): DisposableRegistration {
  const { audioHost, projectGraph, settings } = services
  const eventPublishers = registerIpcEventPublishers(services)
  let disposePluginAnalysis: (() => void) | undefined
  try {
    const synchronizePluginStates = (): Promise<void> =>
      synchronizePluginStatesAtomically(audioHost, projectGraph)
    const context: IpcHandlerContext = {
      ...services,
      projectLifecycle: new ProjectLifecycleService(
        services.projects,
        services.projectGraph,
        services.lifecycle,
        services.operations,
        services.settings,
        services.waveforms
      ),
      synchronizePluginStates,
      sampleSystemPerformance: () => sampleSystemPerformance(settings, audioHost)
    }
    registerSystemHandlers(context)
    registerAudioHandlers(context)
    registerBounceHandlers(context)
    registerMixerHandlers(context)
    registerPluginHandlers(context)
    registerMidiHandlers(context)
    registerLowLatencyHandlers(context)
    registerTransportHandlers(context)
    registerDiagnosticHandlers(context)
    disposePluginAnalysis = registerPluginAnalysisHandlers(context)
    registerSettingsRpcHandlers(context)
    registerProjectHandlers(context)
    if (services.liveDocuments) {
      registerLiveHandlers(
        new LiveDocumentCoordinator(
          services.liveDocuments,
          services.projects,
          services.lifecycle.applicationState,
          services.operations,
          services.settings,
          new LivePerformanceSession(
            services.liveDocuments,
            services.audioHost,
            services.plugins,
            services.lifecycle
          )
        ),
        services.liveDocuments,
        services.lifecycle.applicationState
      )
    }
    registerRecordingHandlers(context)
    return {
      dispose: () => {
        disposePluginAnalysis?.()
        eventPublishers.dispose()
      }
    }
  } catch (error) {
    eventPublishers.dispose()
    disposePluginAnalysis?.()
    throw error
  }
}
