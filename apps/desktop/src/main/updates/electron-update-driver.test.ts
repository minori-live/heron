import { EventEmitter } from "node:events"
import type { AppUpdater } from "electron-updater"
import { describe, expect, it, vi } from "vitest"
import { electronUpdateDriver } from "./electron-update-driver"

describe("electron updater adapter", () => {
  it("disables implicit installation and downgrades and forwards explicit installation", async () => {
    const updater = Object.assign(new EventEmitter(), {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowDowngrade: true,
      allowPrerelease: true,
      channel: "beta",
      disableWebInstaller: false,
      checkForUpdates: vi.fn(async () => ({
        isUpdateAvailable: false,
        updateInfo: { version: "1.0.0" }
      })),
      downloadUpdate: vi.fn(async () => []),
      quitAndInstall: vi.fn()
    })
    const driver = electronUpdateDriver(updater as unknown as AppUpdater, "latest")
    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      allowPrerelease: false,
      channel: "latest",
      disableWebInstaller: true
    })
    expect(await driver.check()).toBeNull()
    await driver.download(vi.fn())
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    driver.install(vi.fn())
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})
