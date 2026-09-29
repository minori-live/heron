import type { AudioResourceSnapshot, DesktopLifecycleSnapshot } from "./audio.ts"
import type { OfflineToolsResourceSnapshot } from "./application.ts"
import type { ProjectWorkspaceSnapshot } from "./project.ts"
import type { LiveWorkspaceSnapshot } from "./live.ts"
import type { RecordingResourceSnapshot } from "./recording.ts"
import type { ApplicationSettingsRef, DesktopSessionRef } from "./rpc.ts"
import type { ApplicationSettingsResourceSnapshot } from "./settings.ts"
import { IPC_PROTOCOL_VERSION } from "./rpc.ts"

export interface ApplicationBootstrapSnapshot {
  protocolVersion: typeof IPC_PROTOCOL_VERSION
  mainEpoch: string
  desktopSession: DesktopSessionRef
  applicationSettings: ApplicationSettingsRef
  revision: number
  offlineTools: OfflineToolsResourceSnapshot
  lifecycle: DesktopLifecycleSnapshot
  audioResources: AudioResourceSnapshot
  recordingResource: RecordingResourceSnapshot | null
  settings: ApplicationSettingsResourceSnapshot
  workspace: ProjectWorkspaceSnapshot | null
  liveWorkspace?: LiveWorkspaceSnapshot | null
}

export interface ProjectCloseResult {
  closed: boolean
  snapshot: ApplicationBootstrapSnapshot
}
