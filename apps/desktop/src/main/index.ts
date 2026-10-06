import { app } from "electron"
import * as Sentry from "@sentry/electron/main"
import { relaunchForLinuxX11 } from "./app/linux-x11"
import { configureApplicationIdentity } from "./app/application-shell"
import { initializeCrashReporting } from "./diagnostics/crash-reporting"
import { configureReportingProfile } from "./diagnostics/reporting-environment"

if (!relaunchForLinuxX11(app, process.platform, process.argv, process.env)) {
  configureApplicationIdentity(app, process.platform)
  configureReportingProfile(app, process.env)
  initializeCrashReporting(app, process.env, Sentry)
  // Static application imports load the native addon during module evaluation.
  const { startMainProcess } = await import("./app/application-main-process")
  startMainProcess(app, process.platform, process.env)
}
