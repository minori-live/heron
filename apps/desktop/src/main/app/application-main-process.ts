import type { App } from "electron"
import { configureApplicationIdentity, quitWhenAllWindowsAreClosed } from "./application-shell"
import { deferProjectClose } from "./dirty-project-close"
import { registerRendererScheme } from "./renderer-security"
import { startApplication, type StartedApplicationServices } from "./startup"
import { mainWindow } from "./windows"
import { settleRpcMutations } from "../ipc"

interface MainProcessDependencies {
  configureApplicationIdentity: typeof configureApplicationIdentity
  deferProjectClose: typeof deferProjectClose
  mainWindow: () => typeof mainWindow
  quitWhenAllWindowsAreClosed: typeof quitWhenAllWindowsAreClosed
  registerRendererScheme: typeof registerRendererScheme
  startApplication: typeof startApplication
}

const defaultDependencies: MainProcessDependencies = {
  configureApplicationIdentity,
  deferProjectClose,
  mainWindow: () => mainWindow,
  quitWhenAllWindowsAreClosed,
  registerRendererScheme,
  startApplication
}

export function startMainProcess(
  application: App,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  dependencies: MainProcessDependencies = defaultDependencies
): void {
  dependencies.configureApplicationIdentity(application, platform)
  dependencies.registerRendererScheme()
  dependencies.quitWhenAllWindowsAreClosed(application)

  if (environment.HERON_TEST_USER_DATA) {
    application.disableHardwareAcceleration()
    application.commandLine.appendSwitch("disable-gpu")
    application.setPath("userData", environment.HERON_TEST_USER_DATA)
  }

  let startedApplicationServices: StartedApplicationServices | null = null
  let shutdownComplete = false
  let shutdownPromise: Promise<void> | null = null
  let updateShutdown = false

  async function prepareUpdateInstall(): Promise<boolean> {
    if (
      shutdownPromise ||
      !startedApplicationServices ||
      startedApplicationServices.projectService.current
    )
      return false
    updateShutdown = true
    const services = startedApplicationServices
    let succeeded = false
    shutdownPromise = (async () => {
      await settleRpcMutations()
      // An already admitted project-open request may have completed while draining.
      if (services.projectService.current) {
        updateShutdown = false
        return
      }
      await services.audioHostService.stopAudioEngine()
      await services.audioHostService.stop()
      await services.projectService.shutdown(true)
      succeeded = true
      shutdownComplete = true
    })().catch((error: unknown) => {
      console.error("Update shutdown failed", error)
    })
    await shutdownPromise
    // Only aborts before native teardown may reopen the mutation gate. A stop
    // failure can leave services partially stopped; ADR-0006 requires quarantine
    // until relaunch, with ordinary quit still available through before-quit.
    if (!updateShutdown) shutdownPromise = null
    return succeeded
  }

  async function shutdownServices(): Promise<void> {
    startedApplicationServices?.dispose()
    const audioHostService = startedApplicationServices?.audioHostService
    await Promise.allSettled([
      (async () => {
        if (!audioHostService) return
        try {
          await audioHostService.stopAudioEngine()
        } catch {
          // The embedded runtime may already be stopping or unavailable.
        }
        await audioHostService.stop()
      })(),
      startedApplicationServices?.projectService.shutdown()
    ])
  }

  dependencies.startApplication(
    () => shutdownPromise !== null,
    (services) => {
      startedApplicationServices = services
    },
    prepareUpdateInstall
  )

  application.on("before-quit", (event) => {
    if (shutdownComplete) {
      if (updateShutdown) startedApplicationServices?.dispose()
      return
    }
    if (updateShutdown) {
      // A failed update shutdown is quarantined. Ordinary quit remains available.
      event.preventDefault()
      void shutdownPromise?.then(() => {
        startedApplicationServices?.dispose()
        shutdownComplete = true
        application.quit()
      })
      return
    }
    if (
      dependencies.deferProjectClose({
        command: "application.quit",
        event,
        project: startedApplicationServices?.projectService.current ?? null,
        window: dependencies.mainWindow()
      })
    ) {
      return
    }
    event.preventDefault()
    if (shutdownPromise) return
    shutdownPromise = shutdownServices().finally(() => {
      shutdownComplete = true
      application.quit()
    })
  })
}
