import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type * as Sentry from "@sentry/electron/main"
import { CrashReporting, SENTRY_DSN } from "./crash-reporting"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function harness(settings?: unknown) {
  const userData = await mkdtemp(join(tmpdir(), "heron-crash-reporting-"))
  directories.push(userData)
  if (settings !== undefined)
    await writeFile(join(userData, "settings.json"), JSON.stringify(settings))
  let options: Sentry.ElectronMainOptions | undefined
  const clientOptions = { enabled: true }
  const transport = { send: vi.fn(async () => ({})), flush: vi.fn(async () => true) }
  const sdk = {
    init: vi.fn((value: Sentry.ElectronMainOptions) => {
      options = value
    }),
    getClient: () => ({ getOptions: () => clientOptions }) as ReturnType<typeof Sentry.getClient>,
    makeElectronTransport: vi.fn(() => transport),
    sentryMinidumpIntegration: () => ({ name: "SentryMinidump" }),
    onUncaughtExceptionIntegration: () => ({ name: "OnUncaughtException" }),
    onUnhandledRejectionIntegration: () => ({ name: "OnUnhandledRejection" }),
    electronContextIntegration: () => ({ name: "ElectronContext" }),
    normalizePathsIntegration: () => ({ name: "NormalizePaths" })
  }
  const application = {
    isPackaged: true,
    getPath: () => userData,
    setPath: vi.fn(),
    getVersion: () => "0.6.3",
    whenReady: vi.fn(async () => {}) as unknown as Electron.App["whenReady"]
  }
  return {
    userData,
    sdk,
    application,
    reporting: new CrashReporting(sdk),
    transport,
    clientOptions,
    options: () => options!
  }
}

describe("crash reporting consent and upload policy", () => {
  it.each([
    undefined,
    {},
    { diagnosticsEnabled: "true" },
    { diagnosticsEnabled: true, diagnosticsConsentEpoch: "../old" }
  ])("discards pending diagnostics without valid committed consent: %j", async (settings) => {
    const h = await harness(settings)
    await mkdir(join(h.userData, "crash-reports/legacy"), { recursive: true })
    await mkdir(join(h.userData, "sentry"))
    await writeFile(join(h.userData, "sentry/pending"), "old report")
    h.reporting.initialize(h.application, {})
    expect(h.sdk.init).not.toHaveBeenCalled()
    expect(existsSync(join(h.userData, "crash-reports"))).toBe(false)
    expect(existsSync(join(h.userData, "sentry"))).toBe(false)
  })

  it("uses only the current consent period and sends crash metadata without personal context", async () => {
    const epoch = "12345678-1234-1234-1234-123456789abc"
    const h = await harness({ diagnosticsEnabled: true, diagnosticsConsentEpoch: epoch })
    await mkdir(join(h.userData, "crash-reports/legacy"), { recursive: true })
    h.reporting.initialize(h.application, {})
    expect(h.application.setPath).toHaveBeenCalledWith(
      "crashDumps",
      join(h.userData, "crash-reports", epoch)
    )
    expect(existsSync(join(h.userData, "crash-reports/legacy"))).toBe(false)
    expect(h.options()).toMatchObject({
      dsn: SENTRY_DSN,
      release: "heron@0.6.3",
      ipcMode: 0,
      defaultIntegrations: false
    })
    const event = {
      type: undefined,
      level: "fatal" as const,
      platform: "native",
      user: { email: "private@example.com" },
      request: { url: "file:///private" },
      extra: { project: "private" },
      breadcrumbs: [{ message: "private" }],
      server_name: "private"
    }
    expect(h.options().beforeSend!(event, {})).toEqual({
      type: undefined,
      level: "fatal",
      platform: "native"
    })
  })

  it("preserves native dumps from an uninterrupted consent period across relaunch", async () => {
    const h = await harness({ diagnosticsEnabled: true })
    await mkdir(join(h.userData, "crash-reports/legacy"), { recursive: true })
    const dump = join(h.userData, "crash-reports/legacy/crash.dmp")
    await writeFile(dump, "native dump")
    h.reporting.initialize(h.application, {})
    expect(await readFile(dump, "utf8")).toBe("native dump")
  })

  it("revokes queued uploads before app readiness and keeps re-enabling pending until relaunch", async () => {
    const h = await harness({ diagnosticsEnabled: true })
    let ready!: () => void
    h.application.whenReady = () =>
      new Promise<void>((resolve) => {
        ready = resolve
      })
    h.reporting.initialize(h.application, {})
    const transport = h.options().transport!({
      url: "https://example.com",
      recordDroppedEvent: () => {}
    })
    const pending = transport.send([{}, []])
    h.reporting.applyConsent(false)
    h.reporting.applyConsent(true)
    ready()
    await pending
    expect(h.transport.send).not.toHaveBeenCalled()
    expect(h.clientOptions.enabled).toBe(false)
    expect(h.options().beforeSend!({ type: undefined, level: "fatal" }, {})).toBeNull()
  })

  it.each(["development", "test"])("never initializes uploads in %s", async (mode) => {
    const h = await harness({ diagnosticsEnabled: true })
    h.application.isPackaged = mode !== "development"
    h.reporting.initialize(
      h.application,
      mode === "test" ? { HERON_TEST_USER_DATA: h.userData } : {}
    )
    expect(h.sdk.init).not.toHaveBeenCalled()
  })

  it("keeps startup available and disables reporting if the SDK fails", async () => {
    const h = await harness({ diagnosticsEnabled: true })
    h.sdk.init.mockImplementation(() => {
      throw new Error("SDK unavailable")
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => h.reporting.initialize(h.application, {})).not.toThrow()
    expect(h.clientOptions.enabled).toBe(false)
  })
})
