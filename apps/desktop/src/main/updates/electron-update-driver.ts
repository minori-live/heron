import type { AppUpdater } from "electron-updater"
import type { UpdateDriver } from "./update-service"

export function electronUpdateDriver(updater: AppUpdater, channel: string): UpdateDriver {
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.channel = channel
  updater.allowPrerelease = channel !== "latest"
  // Setting channel enables downgrade internally, so set this afterwards.
  updater.allowDowngrade = false
  updater.disableWebInstaller = true
  let installFailed: (() => void) | null = null
  const onError = (error: Error): void => {
    console.error("Application update failed", error)
    installFailed?.()
  }
  updater.on("error", onError)
  return {
    async check() {
      const result = await updater.checkForUpdates()
      return result?.isUpdateAvailable ? result.updateInfo.version : null
    },
    async download(progress) {
      const listener = (info: { percent: number }): void => progress(info.percent)
      updater.on("download-progress", listener)
      try {
        await updater.downloadUpdate()
      } finally {
        updater.removeListener("download-progress", listener)
      }
    },
    install(failed) {
      installFailed = failed
      updater.quitAndInstall(false, true)
    },
    dispose() {
      // Keep error handling for an in-flight download during ordinary shutdown.
      updater.autoInstallOnAppQuit = false
    }
  }
}
