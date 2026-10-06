import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { App } from "electron"
import type * as Sentry from "@sentry/electron/main"

export const SENTRY_DSN =
  "https://a4d67c4fbb1ebf80e86024c24cd06a40@o4512208564453376.ingest.us.sentry.io/4512208570679296"

type CrashSdk = Pick<
  typeof Sentry,
  | "init"
  | "makeElectronTransport"
  | "sentryMinidumpIntegration"
  | "onUncaughtExceptionIntegration"
  | "onUnhandledRejectionIntegration"
  | "electronContextIntegration"
  | "normalizePathsIntegration"
> & { getClient(): { getOptions(): { enabled?: boolean } } | undefined }
type CrashApplication = Pick<App, "getPath" | "setPath" | "getVersion" | "whenReady" | "isPackaged">

export class CrashReporting {
  private allowed = false

  constructor(private readonly sdk: CrashSdk) {}

  initialize(application: CrashApplication, environment: NodeJS.ProcessEnv): void {
    // Tests and local development never send reports, even with copied preferences.
    if (!application.isPackaged || environment.HERON_TEST_USER_DATA) return
    try {
      const userData = application.getPath("userData")
      const root = join(userData, "crash-reports")
      let consent = false
      let epoch = "legacy"
      try {
        const settings = JSON.parse(readFileSync(join(userData, "settings.json"), "utf8")) as {
          diagnosticsEnabled?: unknown
          diagnosticsConsentEpoch?: unknown
        }
        consent = settings.diagnosticsEnabled === true
        if (settings.diagnosticsConsentEpoch !== undefined) {
          if (
            typeof settings.diagnosticsConsentEpoch !== "string" ||
            !/^[a-f0-9-]{36}$/.test(settings.diagnosticsConsentEpoch)
          ) {
            consent = false
          } else {
            epoch = settings.diagnosticsConsentEpoch
          }
        }
      } catch {
        // Missing, unreadable or malformed preferences are never consent.
      }
      if (!consent) {
        rmSync(root, { recursive: true, force: true })
        rmSync(join(userData, "sentry"), { recursive: true, force: true })
        return
      }
      const dumps = join(root, epoch)
      if (!existsSync(dumps)) {
        // Context cached for a previous consent period must not be restored.
        rmSync(join(userData, "sentry"), { recursive: true, force: true })
      }
      mkdirSync(root, { recursive: true })
      for (const entry of readdirSync(root)) {
        if (entry !== epoch) rmSync(join(root, entry), { recursive: true, force: true })
      }
      mkdirSync(dumps, { recursive: true })
      application.setPath("crashDumps", dumps)
      this.allowed = true
      this.sdk.init({
        dsn: SENTRY_DSN,
        release: `heron@${application.getVersion()}`,
        environment: "production",
        defaultIntegrations: false,
        integrations: [
          this.sdk.sentryMinidumpIntegration(),
          this.sdk.onUncaughtExceptionIntegration(),
          this.sdk.onUnhandledRejectionIntegration({ mode: "strict" }),
          this.sdk.electronContextIntegration(),
          this.sdk.normalizePathsIntegration()
        ],
        // The SDK uses a bitmask. Zero installs no SDK IPC or protocol handlers.
        ipcMode: 0 as Sentry.IPCMode,
        getSessions: () => [],
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          stackFrameVariables: false,
          frameContextLines: 0
        },
        maxBreadcrumbs: 0,
        beforeSendLog: () => null,
        beforeSendMetric: () => null,
        enableOpenTelemetrySetup: false,
        sendClientReports: false,
        transport: (options) => {
          // No disk-backed retry queue: revocation cannot leave uploads for later.
          const transport = this.sdk.makeElectronTransport(options)
          return {
            send: async (envelope) => {
              await application.whenReady()
              return this.allowed ? transport.send(envelope) : {}
            },
            flush: (timeout) => transport.flush(timeout)
          }
        },
        beforeSend: (event) => {
          if (!this.allowed) return null
          delete event.user
          delete event.request
          delete event.extra
          delete event.breadcrumbs
          delete event.server_name
          return event
        }
      })
    } catch (error) {
      this.applyConsent(false)
      console.error("Could not initialize crash reporting", error)
    }
  }

  applyConsent(enabled: boolean): void {
    // Enabling requires a new launch. Revocation remains latched for this run.
    if (enabled) return
    this.allowed = false
    const client = this.sdk.getClient()
    if (client) client.getOptions().enabled = false
  }
}

let reporting: CrashReporting | undefined

export function initializeCrashReporting(
  application: CrashApplication,
  environment: NodeJS.ProcessEnv,
  sdk: CrashSdk
): void {
  reporting = new CrashReporting(sdk)
  reporting.initialize(application, environment)
}

export function applyDiagnosticsConsent(enabled: boolean): void {
  reporting?.applyConsent(enabled)
}
