export type UpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error"
  | "quarantined"

export type UpdateFailure =
  | "check-failed"
  | "download-failed"
  | "shutdown-failed"
  | "install-failed"

export interface ApplicationUpdateSnapshot {
  revision: number
  phase: UpdatePhase
  currentVersion: string
  channel: string | null
  availableVersion: string | null
  progress: number
  error: UpdateFailure | null
}

export type ApplicationUpdateCommand = "check" | "download" | "install"
export type ApplicationUpdateResult =
  | { accepted: true; snapshot: ApplicationUpdateSnapshot }
  | {
      accepted: false
      reason: "disabled" | "busy" | "project-open" | "not-ready" | "request-limit"
      snapshot: ApplicationUpdateSnapshot
    }
