import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { closeElectronApplication } from "./support"

async function openPluginAnalysis(application: ElectronApplication, page: Page): Promise<void> {
  if (process.platform === "darwin") {
    // AppTitleBar omits the renderer menubar on macOS, so drive the native menu.
    await application.evaluate(({ Menu }) => {
      const help = Menu.getApplicationMenu()?.items.find((item) => item.label === "Help")
      const open = help?.submenu?.items.find((item) => item.label?.startsWith("Plugin Analysis"))
      if (!open || !open.enabled) throw new Error("Help > Plugin Analysis is unavailable")
      Reflect.apply(open.click, open, [])
    })
  } else {
    await page.getByRole("menuitem", { name: "Help", exact: true }).click()
    await page.getByRole("menuitem", { name: /Plugin Analysis/ }).click()
  }
}

test("Help opens an independent PluginAnalysis bridge and measures above full scale without a project", async () => {
  test.setTimeout(90000)
  const profile = await mkdtemp(join(tmpdir(), "heron-plugin-analysis-e2e-"))
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
  application.on("window", (page) => {
    page.on("pageerror", (error) => console.error("PluginAnalysis window error:", error.message))
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text())
    })
  })
  try {
    await expect
      .poll(() => application.windows().some((page) => page.url().includes("index.html")))
      .toBe(true)
    const main = application.windows().find((page) => page.url().includes("index.html"))!
    await openPluginAnalysis(application, main)
    await expect
      .poll(() => application.windows().some((page) => page.url().includes("plugin-analysis.html")))
      .toBe(true)
    const pluginAnalysis = application
      .windows()
      .find((page) => page.url().includes("plugin-analysis.html"))!
    await expect(pluginAnalysis.getByRole("button", { name: "Analyze", exact: true })).toBeVisible()
    await expect(
      pluginAnalysis.getByRole("button", { name: "Add VST3 audio effect", exact: true })
    ).toBeVisible()
    expect(
      await pluginAnalysis.evaluate(() => ({
        desktop: typeof (window as unknown as Record<string, unknown>).heron,
        pluginAnalysis: typeof (window as unknown as Record<string, unknown>).heronPluginAnalysis
      }))
    ).toEqual({ desktop: "undefined", pluginAnalysis: "object" })
    const automatic = pluginAnalysis.getByRole("checkbox", { name: "Auto analyze" })
    await automatic.uncheck()
    const level = pluginAnalysis.getByRole("slider", { name: "Sweep input level" })
    await level.press("End")
    for (let step = 0; step < 12; step++) await level.press("ArrowLeft")
    await expect(level).toHaveValue("6")
    await pluginAnalysis.getByRole("button", { name: "Analyze", exact: true }).click()
    await expect(pluginAnalysis.getByText(/\+6\.0 dBFS/).first()).toBeVisible()
    // The slider text is only a preview; wait for the native report and assert its
    // recorded input level so the test fails when analysis never completes.
    await expect
      .poll(
        () =>
          pluginAnalysis.evaluate(async () => {
            const api = (window as unknown as Record<string, unknown>).heronPluginAnalysis as {
              snapshot(meta: { protocolVersion: number; requestId: string }): Promise<{
                ok: boolean
                value?: { report: { settings: { level_dbfs: number } } | null }
              }>
            }
            const result = await api.snapshot({
              protocolVersion: 2,
              requestId: crypto.randomUUID()
            })
            return result.ok ? (result.value?.report?.settings.level_dbfs ?? null) : null
          }),
        { timeout: 45000 }
      )
      .toBe(6)
    for (const name of ["Linear", "Harmonics", "Hammerstein", "Performance"]) {
      await pluginAnalysis.getByRole("tab", { name, exact: true }).click()
    }
    await expect(pluginAnalysis.locator(".performance-panel")).toBeVisible()
    await pluginAnalysis.screenshot({
      path: test.info().outputPath("plugin-analysis.png"),
      fullPage: true
    })
    await pluginAnalysis.close()
    expect(main.isClosed()).toBe(false)
  } finally {
    await closeElectronApplication(application)
  }
})
