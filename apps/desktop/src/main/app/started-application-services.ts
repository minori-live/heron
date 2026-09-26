import type { AudioHostService } from "../audio-host"
import type { LiveDocumentService, ProjectService } from "../project"

export interface ApplicationDisposable {
  dispose(): void
}

export interface StartedApplicationServices extends ApplicationDisposable {
  audioHostService: AudioHostService
  projectService: ProjectService
  liveDocumentService?: LiveDocumentService
}

export function createStartedApplicationServices(
  audioHostService: AudioHostService,
  projectService: ProjectService,
  registrations: readonly ApplicationDisposable[],
  liveDocumentService?: LiveDocumentService
): StartedApplicationServices {
  let disposed = false
  return {
    audioHostService,
    projectService,
    liveDocumentService,
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const registration of registrations) registration.dispose()
    }
  }
}
