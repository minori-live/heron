import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test"
import {
  pluginDescriptorKey,
  type HeronPluginAnalysisApi,
  type PluginAnalysisCommand,
  type PluginAnalysisSnapshot
} from "@heron/contracts"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { closeElectronApplication } from "./support"

async function snapshot(page: Page): Promise<PluginAnalysisSnapshot> {
  return page.evaluate(async () => {
    const api = (window as unknown as { heronPluginAnalysis: HeronPluginAnalysisApi })
      .heronPluginAnalysis
    const result = await api.snapshot({ protocolVersion: 2, requestId: crypto.randomUUID() })
    if (!result.ok) throw new Error(`Analysis snapshot failed: ${result.error.code}`)
    return result.value
  })
}

async function command(page: Page, value: PluginAnalysisCommand): Promise<PluginAnalysisSnapshot> {
  return page.evaluate(async (value) => {
    const api = (window as unknown as { heronPluginAnalysis: HeronPluginAnalysisApi })
      .heronPluginAnalysis
    const current = await api.snapshot({ protocolVersion: 2, requestId: crypto.randomUUID() })
    if (!current.ok) throw new Error(`Analysis snapshot failed: ${current.error.code}`)
    const operationId = crypto.randomUUID()
    const result = await api.command(
      {
        protocolVersion: 2,
        requestId: crypto.randomUUID(),
        target: current.value.ref,
        expectedRevision: current.value.revision,
        mutation: { operationId, idempotencyKey: operationId }
      },
      value
    )
    if (!result.ok) throw new Error(`Analysis command failed: ${result.error.code}`)
    return result.value
  }, value)
}

async function editorWindows(application: ElectronApplication) {
  return application.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .filter((window) => window.getTitle() === "Plugin Analysis — Heron Gain")
      .map((window) => ({
        id: window.id,
        parentId: window.getParentWindow()?.id ?? null,
        visible: window.isVisible(),
        childParentIds: window.getChildWindows().map((child) => child.getParentWindow()?.id)
      }))
  )
}

test("Analysis plug-in editors stay independent of the main Editor and clean up with their instances", async () => {
  test.setTimeout(150_000)
  const profile = await mkdtemp(join(tmpdir(), "heron-independent-plugin-editor-e2e-"))
  const executablePath = process.env.HERON_E2E_EXECUTABLE
  const application = await electron.launch({
    executablePath,
    args: [
      ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--no-sandbox",
      ...(executablePath ? [] : [resolve(import.meta.dirname, "..")])
    ],
    env: {
      ...process.env,
      HERON_TEST_USER_DATA: join(profile, "user-data"),
      HERON_TEST_CAPTURE_SOURCE: "1",
      HERON_TEST_MOCK_AUDIO: "1"
    }
  })
  try {
    await expect
      .poll(() => application.windows().some((page) => page.url().includes("index.html")))
      .toBe(true)
    const main = application.windows().find((page) => page.url().includes("index.html"))!
    const mainWindow = await application.browserWindow(main)
    if (process.platform === "darwin") {
      await application.evaluate(({ Menu }) => {
        const help = Menu.getApplicationMenu()?.items.find((item) => item.label === "Help")
        const open = help?.submenu?.items.find((item) => item.label?.startsWith("Plugin Analysis"))
        if (!open || !open.enabled) throw new Error("Help > Plugin Analysis is unavailable")
        Reflect.apply(open.click, open, [])
      })
    } else {
      await main.getByRole("menuitem", { name: "Help", exact: true }).click()
      await main.getByRole("menuitem", { name: /Plugin Analysis/ }).click()
    }
    await expect
      .poll(() => application.windows().some((page) => page.url().includes("plugin-analysis.html")))
      .toBe(true)
    const analysis = application
      .windows()
      .find((page) => page.url().includes("plugin-analysis.html"))!
    await expect(analysis.getByRole("button", { name: "Analyze", exact: true })).toBeVisible()
    await command(analysis, { type: "automatic", enabled: false })
    const gain = (await snapshot(analysis)).catalog.find(
      (plugin) => plugin.name === "Heron Gain" && plugin.source.kind === "builtin"
    )
    expect(gain, "the bundled Heron Gain must be discovered by the real native probe").toBeDefined()
    const insert = {
      type: "insert",
      pluginKey: pluginDescriptorKey(gain!),
      audioMode: "stereo",
      slotOrder: 0
    } as const
    const first = await command(analysis, insert)
    expect(first.failure).toBeNull()
    expect(first.plugins).toHaveLength(1)
    const firstId = first.plugins[0].id
    const openEditor = analysis.getByRole("button", { name: "Open Heron Gain editor", exact: true })
    await expect(openEditor).toBeVisible()

    const analysisWindow = await application.browserWindow(analysis)
    await analysisWindow.evaluate((window) => window.focus())
    const mainFocuses = await mainWindow.evaluateHandle((window) => {
      const observed = { count: 0 }
      window.on("focus", () => observed.count++)
      return observed
    })
    await openEditor.click()
    await expect
      .poll(async () => (await snapshot(analysis)).runtime[firstId]?.editorOpen)
      .toBe(true)
    expect((await snapshot(analysis)).runtime[firstId]?.editorMode).toBe("native")
    await expect.poll(async () => (await editorWindows(application)).length).toBe(1)
    const initial = (await editorWindows(application))[0]
    expect(initial).toMatchObject({ parentId: null, visible: true, childParentIds: [initial.id] })
    expect(await mainFocuses.evaluate((observed) => observed.count)).toBe(0)

    // Hosted Linux E2E uses bare Xvfb without a window manager. Its ownership and
    // close lifecycle are covered below; minimize behavior needs a desktop session.
    if (process.platform !== "linux") {
      await mainWindow.evaluate((window) => window.minimize())
      await expect.poll(() => mainWindow.evaluate((window) => window.isMinimized())).toBe(true)
      await analysisWindow.evaluate((window) => window.focus())
      await openEditor.click()
      await expect.poll(async () => (await editorWindows(application))[0]?.visible).toBe(true)
      expect(await mainWindow.evaluate((window) => window.isMinimized())).toBe(true)
      expect(await mainFocuses.evaluate((observed) => observed.count)).toBe(0)
    }

    await mainWindow.evaluate((window) => window.close())
    await expect.poll(() => main.isClosed()).toBe(true)
    expect(analysis.isClosed()).toBe(false)
    expect((await editorWindows(application))[0]?.id).toBe(initial.id)

    await application.evaluate(({ BaseWindow }, id) => BaseWindow.fromId(id)?.close(), initial.id)
    await expect.poll(async () => (await editorWindows(application)).length).toBe(0)
    await openEditor.click()
    await expect.poll(async () => (await editorWindows(application)).length).toBe(1)
    const reopened = (await editorWindows(application))[0]
    expect(reopened.id).not.toBe(initial.id)
    expect(reopened.parentId).toBeNull()

    const second = await command(analysis, { ...insert, slotOrder: 1 })
    expect(second.failure).toBeNull()
    expect(second.plugins).toHaveLength(2)
    await expect(openEditor).toHaveCount(2)
    await openEditor.nth(1).click()
    await expect.poll(async () => (await editorWindows(application)).length).toBe(2)
    for (const window of await editorWindows(application)) {
      expect(window).toMatchObject({ parentId: null, visible: true, childParentIds: [window.id] })
    }
    await analysis.screenshot({ path: test.info().outputPath("analysis-without-main.png") })

    await openEditor.first().hover()
    await analysis.getByRole("button", { name: "Remove Heron Gain", exact: true }).first().click()
    await expect.poll(async () => (await snapshot(analysis)).plugins.length).toBe(1)
    await expect.poll(async () => (await editorWindows(application)).length).toBe(1)
    expect((await editorWindows(application))[0]?.id).not.toBe(reopened.id)

    // Exercise the native close event; Page.close() only closes the web contents
    // and does not represent the user's window-close operation in Electron.
    // Keep the main process inspectable after Heron's before-quit cleanup. The
    // Playwright inspector can otherwise hold OS process exit after its context
    // has already closed. Explicit application.close() below performs final quit.
    const cleanup = await application.evaluateHandle(({ app }) => {
      const observed = { complete: false }
      app.once("will-quit", (event) => {
        event.preventDefault()
        observed.complete = true
      })
      return observed
    })
    await analysisWindow.evaluate((window) => window.close())
    await expect.poll(() => analysis.isClosed()).toBe(true)
    await expect.poll(() => cleanup.evaluate((observed) => observed.complete)).toBe(true)
    await expect
      .poll(() =>
        application.evaluate(({ BaseWindow }) =>
          BaseWindow.getAllWindows().map((window) => ({ id: window.id, title: window.getTitle() }))
        )
      )
      .toEqual([])
    await application.close()
    expect(application.process().exitCode).toBe(0)
  } finally {
    if (application.process().exitCode === null) await closeElectronApplication(application)
  }
})
