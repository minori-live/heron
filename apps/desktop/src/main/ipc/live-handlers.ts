import { dialog } from "electron"
import { AUDIO_BACKENDS, IPC_CHANNELS, PROJECT_SAMPLE_RATES } from "@heron/contracts"
import type { LiveDocumentConfiguration, LiveEditCommand } from "@heron/contracts"
import type { LiveDocumentService } from "../project"
import type { LiveDocumentCoordinator } from "./live-document-coordinator"
import type { ApplicationStateStore } from "../kernel"
import { registerRpcHandler } from "./rpc"
import { validateReadTarget, validationFailure } from "./resource-validation"
import { isLiveFilePath, isProjectFilePath } from "../project"
import { t } from "../settings"

function isConfiguration(value: unknown): value is LiveDocumentConfiguration {
  if (!value || typeof value !== "object") return false
  const input = value as Partial<LiveDocumentConfiguration>
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    !PROJECT_SAMPLE_RATES.includes(input.sampleRate as (typeof PROJECT_SAMPLE_RATES)[number]) ||
    !Array.isArray(input.enabledMidiDeviceIds) ||
    input.enabledMidiDeviceIds.some((id) => typeof id !== "string" || !id.trim())
  )
    return false
  if (input.audio === null) return true
  const audio = input.audio
  return Boolean(
    audio &&
    AUDIO_BACKENDS.includes(audio.backend) &&
    typeof audio.inputDeviceId === "string" &&
    audio.inputDeviceId &&
    typeof audio.outputDeviceId === "string" &&
    audio.outputDeviceId &&
    Number.isInteger(audio.bufferSize) &&
    audio.bufferSize >= 16 &&
    audio.bufferSize <= 16_384
  )
}

function isEditCommand(value: unknown): value is LiveEditCommand {
  if (!value || typeof value !== "object") return false
  const command = value as Partial<LiveEditCommand>
  return (
    typeof command.type === "string" &&
    [
      "create-channel",
      "update-channel",
      "delete-channel",
      "create-send",
      "update-send",
      "delete-send",
      "create-plugin",
      "update-plugin",
      "delete-plugin",
      "set-midi-bindings"
    ].includes(command.type)
  )
}

export function registerLiveHandlers(
  coordinator: LiveDocumentCoordinator,
  documents: LiveDocumentService,
  state: ApplicationStateStore
): void {
  registerRpcHandler(IPC_CHANNELS.documentPrepareOpen, async ({ meta }, pathValue: unknown) => {
    const invalid = validateReadTarget(meta, state.desktopSession)
    if (invalid) return invalid
    if (
      pathValue !== undefined &&
      (typeof pathValue !== "string" ||
        (!isLiveFilePath(pathValue) && !isProjectFilePath(pathValue)))
    ) {
      return validationFailure(meta, "path")
    }
    let path = pathValue
    if (!path) {
      const result = await dialog.showOpenDialog({
        title: t("dialog.openProject.title"),
        properties: ["openFile"],
        filters: [{ name: t("dialog.openProject.filter"), extensions: ["hrs", "heron", "hrl"] }]
      })
      path = result.filePaths[0]
      if (result.canceled || !path) return null
    }
    return { kind: isLiveFilePath(path) ? ("live" as const) : ("studio" as const), path }
  })

  registerRpcHandler(
    IPC_CHANNELS.liveCreate,
    async ({ meta }, value: unknown, pathValue: unknown) => {
      if (!isConfiguration(value) || (pathValue !== undefined && typeof pathValue !== "string")) {
        return validationFailure(meta, "configuration")
      }
      let path = pathValue ?? process.env.HERON_TEST_LIVE_PATH
      if (!path) {
        const result = await dialog.showSaveDialog({
          title: t("dialog.createLive.title"),
          defaultPath: `${value.name}.hrl`,
          filters: [{ name: t("dialog.createLive.filter"), extensions: ["hrl"] }]
        })
        if (result.canceled || !result.filePath) return validationFailure(meta, "path")
        path = result.filePath
      }
      return coordinator.create(meta, value, path)
    }
  )

  registerRpcHandler(IPC_CHANNELS.livePrepareOpen, async ({ meta }, pathValue: unknown) => {
    const invalid = validateReadTarget(meta, state.desktopSession)
    if (invalid) return invalid
    if (pathValue !== undefined && (typeof pathValue !== "string" || !isLiveFilePath(pathValue))) {
      return validationFailure(meta, "path")
    }
    let path = pathValue
    if (!path) {
      const result = await dialog.showOpenDialog({
        title: t("dialog.openLive.title"),
        properties: ["openFile"],
        filters: [{ name: t("dialog.openLive.filter"), extensions: ["hrl"] }]
      })
      path = result.filePaths[0]
      if (result.canceled || !path) return null
    }
    return { path, recoverableWorkingCopy: await documents.hasRecoverableWorkingCopy(path) }
  })

  registerRpcHandler(IPC_CHANNELS.liveOpen, ({ meta }, path: unknown, recover: unknown) => {
    if (
      typeof path !== "string" ||
      !isLiveFilePath(path) ||
      (recover !== undefined && typeof recover !== "boolean")
    )
      return validationFailure(meta, "path")
    return coordinator.open(meta, path, recover === true)
  })
  registerRpcHandler(IPC_CHANNELS.liveSnapshot, ({ meta }) => coordinator.snapshot(meta))
  registerRpcHandler(IPC_CHANNELS.liveSave, ({ meta }) => coordinator.save(meta))
  registerRpcHandler(IPC_CHANNELS.liveClose, ({ meta }, disposition: unknown) => {
    if (disposition !== "save" && disposition !== "discard" && disposition !== "cancel") {
      return validationFailure(meta, "disposition")
    }
    return coordinator.close(meta, disposition)
  })
  registerRpcHandler(IPC_CHANNELS.liveEdit, ({ meta }, command: unknown) => {
    if (!isEditCommand(command)) return validationFailure(meta, "command")
    return coordinator.edit(meta, command)
  })
  registerRpcHandler(IPC_CHANNELS.liveConfigure, ({ meta }, configuration: unknown) => {
    if (!isConfiguration(configuration)) return validationFailure(meta, "configuration")
    return coordinator.configure(meta, configuration)
  })
  registerRpcHandler(IPC_CHANNELS.liveUndo, ({ meta }) => coordinator.edit(meta, "undo"))
  registerRpcHandler(IPC_CHANNELS.liveRedo, ({ meta }) => coordinator.edit(meta, "redo"))
}
