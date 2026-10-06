interface StoredDiagnosticsConsent {
  diagnosticsEnabled?: unknown
  diagnosticsConsentEpoch?: unknown
}

export function readDiagnosticsConsent(settings: StoredDiagnosticsConsent): {
  enabled: boolean
  epoch: string | null
} {
  const enabled = settings.diagnosticsEnabled === true
  const epoch = settings.diagnosticsConsentEpoch
  // Older versions had no epoch, and an unrelated save could write this sentinel.
  // Both represent the original consent period, never a new opt-in.
  if (epoch === undefined || epoch === "legacy") {
    return { enabled, epoch: enabled ? "legacy" : null }
  }
  if (
    typeof epoch === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(epoch)
  ) {
    return { enabled, epoch }
  }
  // Malformed explicit authority must not become consent after an unrelated save.
  return { enabled: false, epoch: null }
}
