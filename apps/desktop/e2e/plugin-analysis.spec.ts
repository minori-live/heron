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
  test.setTimeout(150000)
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
    await pluginAnalysis.getByRole("button", { name: "Measurement settings" }).click()
    await pluginAnalysis.getByRole("combobox", { name: "Linear excitation" }).selectOption("delta")
    await pluginAnalysis.getByRole("combobox", { name: "FFT size" }).selectOption("32768")
    await pluginAnalysis.screenshot({
      path: test.info().outputPath("settings.png"),
      fullPage: true
    })
    await pluginAnalysis.getByRole("button", { name: "Measurement settings" }).click()
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
                value?: {
                  report: {
                    settings: { level_dbfs: number; fft_size: number; linear_excitation: string }
                  } | null
                }
              }>
            }
            const result = await api.snapshot({
              protocolVersion: 2,
              requestId: crypto.randomUUID()
            })
            const settings = result.ok ? result.value?.report?.settings : null
            return settings
              ? {
                  level: settings.level_dbfs,
                  fft: settings.fft_size,
                  excitation: settings.linear_excitation
                }
              : null
          }),
        { timeout: 45000 }
      )
      .toEqual({ level: 6, fft: 32768, excitation: "delta" })
    // This raw native unity response exercises the bundled module Worker under
    // Electron's real file:// origin and CSP, beyond browser-only IPC fixtures.
    await pluginAnalysis
      .getByRole("combobox", { name: "Input → output", exact: true })
      .selectOption({ label: "L → L" })
    await expect(pluginAnalysis.getByRole("spinbutton", { name: "EQ quota" })).toHaveValue("3")
    await pluginAnalysis.getByRole("button", { name: "Fit EQ", exact: true }).click()
    const eqResult = pluginAnalysis.getByRole("region", { name: "EQ fit result", exact: true })
    await expect(eqResult).toBeVisible()
    const eqMetrics = await eqResult.evaluate((element) => {
      const value = (label: string): number => {
        const term = [...element.querySelectorAll("dt")].find((item) => item.textContent === label)
        return Number.parseFloat(term!.nextElementSibling!.textContent.replaceAll("−", "-"))
      }
      return { overallGain: value("Overall Gain"), rmsError: value("RMS error") }
    })
    expect(Math.abs(eqMetrics.overallGain)).toBeLessThan(0.05)
    expect(eqMetrics.rmsError).toBeLessThan(0.05)
    await pluginAnalysis.screenshot({
      path: test.info().outputPath("native-eq-fit.png"),
      fullPage: true
    })
    const compare = pluginAnalysis.getByRole("checkbox", { name: "Compare chains" })
    await compare.focus()
    await compare.press("Space")
    await expect(compare).toBeChecked()
    await pluginAnalysis.getByRole("button", { name: "Analyze", exact: true }).click()
    await expect
      .poll(
        () =>
          pluginAnalysis.evaluate(async () => {
            const api = (window as unknown as Record<string, unknown>).heronPluginAnalysis as {
              snapshot(meta: { protocolVersion: number; requestId: string }): Promise<{
                ok: boolean
                value?: {
                  status: string
                  failure: string | null
                  comparisonReport: unknown
                  differenceReport: { responses: Array<{ magnitude_db: number[] }> } | null
                }
              }>
            }
            const result = await api.snapshot({
              protocolVersion: 2,
              requestId: crypto.randomUUID()
            })
            const value = result.value
            return {
              status: value?.status,
              failure: value?.failure,
              comparison: Boolean(value?.comparisonReport),
              difference: value?.differenceReport?.responses.length,
              zero: value?.differenceReport?.responses.every((channel) =>
                channel.magnitude_db.every((magnitude) => magnitude <= -120)
              )
            }
          }),
        { timeout: 90000 }
      )
      .toEqual({ status: "complete", failure: null, comparison: true, difference: 4, zero: true })
    await pluginAnalysis.getByRole("button", { name: "1 − 2", exact: true }).click()
    await pluginAnalysis.getByRole("button", { name: "1 | 2", exact: true }).click()
    for (const name of [
      "Linear",
      "Harmonics",
      "Distortion",
      "Oscilloscope",
      "Dynamics",
      "Hammerstein",
      "Performance"
    ]) {
      await pluginAnalysis.getByRole("tab", { name, exact: true }).click()
      await pluginAnalysis.screenshot({
        path: test.info().outputPath(`${name.toLowerCase()}.png`),
        fullPage: true
      })
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
