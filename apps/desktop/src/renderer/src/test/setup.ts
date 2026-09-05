import { config } from "@vue/test-utils"
import { afterEach, vi } from "vitest"
import type { HeronDesktopApi, HeronSplashApi } from "@heron/contracts"
import { i18n } from "../i18n"
import { rpcSuccess, testBootstrap } from "./ipc"

const api = {
  subscribeUpdates: vi.fn(() => () => undefined),
  updateSnapshot: vi.fn(async () =>
    rpcSuccess({
      revision: 0,
      phase: "disabled",
      currentVersion: "0.5.0",
      channel: null,
      availableVersion: null,
      progress: 0,
      error: null
    })
  ),
  platform: "win32",
  bootstrap: vi.fn(async () => rpcSuccess(testBootstrap())),
  subscribeOperations: vi.fn(() => () => undefined),
  subscribePluginScan: vi.fn(() => () => undefined),
  subscribePluginEditorClosed: vi.fn(() => () => undefined),
  subscribePluginRuntime: vi.fn(() => () => undefined),
  retryPlugin: vi.fn(),
  subscribeExternalProjectCommands: vi.fn(() => () => undefined),
  cancelOperation: vi.fn(async () => rpcSuccess({ state: "cancelled" })),
  acknowledgeOperation: vi.fn(async () => rpcSuccess(undefined)),
  subscribeApplicationCommands: vi.fn(() => () => undefined),
  executeApplicationWindowCommand: vi.fn(),
  setApplicationWindowTheme: vi.fn()
} as unknown as HeronDesktopApi

Object.defineProperty(window, "heron", { configurable: true, value: api })
Object.defineProperty(window, "heronSplash", {
  configurable: true,
  value: {
    subscribeStartupProgress: vi.fn(() => () => undefined)
  } satisfies HeronSplashApi
})

if (!config.global.plugins.includes(i18n)) {
  config.global.plugins.push(i18n)
}

afterEach(() => {
  document.body.innerHTML = ""
  window.localStorage?.clear()
})
