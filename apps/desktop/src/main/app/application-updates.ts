import { app, BrowserWindow, ipcMain } from "electron"
import { IPC_CHANNELS, IPC_PROTOCOL_VERSION } from "@heron/contracts"
import type { ReleaseBuild } from "../../shared/release-build"
import type { ApplicationServices } from "../ipc"
import type { ApplicationDisposable } from "./started-application-services"
import { registerRpcHandler } from "../ipc"
import {
  validateReadTarget,
  validateMutationTarget,
  validationFailure,
  revisionConflictFailure
} from "../ipc"
import { UpdateService, electronUpdateDriver } from "../updates"

declare const __HERON_RELEASE__: ReleaseBuild | null

export async function registerUpdates(
  context: ApplicationServices,
  prepareInstall: () => Promise<boolean>
): Promise<ApplicationDisposable> {
  const release = typeof __HERON_RELEASE__ === "undefined" ? null : __HERON_RELEASE__
  const enabled =
    app.isPackaged &&
    release?.version === app.getVersion() &&
    (process.platform !== "linux" || Boolean(process.env.APPIMAGE))
  // Do not even instantiate the updater in development or packaging smoke builds.
  const module = enabled ? await import("electron-updater") : null
  const driver =
    module && release ? electronUpdateDriver(module.default.autoUpdater, release.channel) : null
  const target = context.lifecycle.applicationState.desktopSession
  const service = new UpdateService({
    currentVersion: app.getVersion(),
    channel: driver ? release!.channel : null,
    driver,
    hasProject: () => context.projects.current !== null,
    prepareInstall,
    async isIdle() {
      if (context.isShuttingDown() || context.operations.activeCount > 0) return false
      const snapshot = context.lifecycle.applicationState.lifecycleSnapshot()
      if (snapshot.recording.status !== "idle") return false
      if (snapshot.audio.status === "stopped") return true
      if (snapshot.audio.status !== "running") return false
      return (await context.transport.snapshot()).state === "stopped"
    },
    publish(snapshot) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed() || window.webContents.isDestroyed()) continue
        window.webContents.send(IPC_CHANNELS.updateEvent, {
          protocolVersion: IPC_PROTOCOL_VERSION,
          sourceEpoch: target.epoch,
          sequence: snapshot.revision,
          resourceRevision: snapshot.revision,
          payload: snapshot
        })
      }
    }
  })
  registerRpcHandler(
    IPC_CHANNELS.updateSnapshot,
    ({ meta }) => validateReadTarget(meta, target) ?? service.snapshot()
  )
  registerRpcHandler(IPC_CHANNELS.updateCommand, ({ meta }, command: unknown) => {
    const invalid = validateMutationTarget(meta, target)
    if (invalid) return invalid
    if (command !== "check" && command !== "download" && command !== "install")
      return validationFailure(meta, "command")
    const key = meta.mutation!.idempotencyKey
    const replay = service.replay(key, command)
    if (replay) return replay
    if (meta.expectedRevision !== service.snapshot().revision)
      return revisionConflictFailure(meta, target, service.snapshot().revision)
    return service.command(command, key)
  })
  service.start()
  return {
    dispose() {
      ipcMain.removeHandler(IPC_CHANNELS.updateSnapshot)
      ipcMain.removeHandler(IPC_CHANNELS.updateCommand)
      service.dispose()
    }
  }
}
