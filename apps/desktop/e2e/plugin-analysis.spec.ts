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
import type { HeronPluginAnalysisApi } from "@heron/contracts"
import { completeWelcomeSetup, closeElectronApplication } from "./support"

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

async function openEqFit(application: ElectronApplication, analysis: Page): Promise<Page> {
  await analysis.bringToFront()
  await analysis.getByRole("button", { name: "EQ Fit", exact: true }).click()
  await expect
    .poll(
      () =>
        application.windows().filter((page) => page.url().includes("plugin-analysis-eq-fit.html"))
          .length
    )
    .toBe(1)
  const child = application
    .windows()
    .find((page) => page.url().includes("plugin-analysis-eq-fit.html"))!
  await expect(child.getByRole("button", { name: "Fit EQ", exact: true })).toBeVisible()
  return child
}

async function nativeReportId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const api = (window as unknown as { heronPluginAnalysis: HeronPluginAnalysisApi })
      .heronPluginAnalysis
    const result = await api.snapshot({ protocolVersion: 2, requestId: crypto.randomUUID() })
    return result.ok ? result.value.reportId : null
  })
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
    await completeWelcomeSetup(main)
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
    // L+R keeps the original Analysis workspace without a fit panel or launcher.
    const eqLauncher = pluginAnalysis.getByRole("button", { name: "EQ Fit", exact: true })
    const signalPath = pluginAnalysis.getByRole("combobox", { name: "Input → output", exact: true })
    await expect(eqLauncher).toHaveCount(0)
    await expect(pluginAnalysis.getByRole("spinbutton", { name: "EQ quota" })).toHaveCount(0)
    await signalPath.selectOption({ label: "L → L" })
    const chart = pluginAnalysis.getByRole("img", { name: "Frequency response", exact: true })
    const beforeOpening = await chart.boundingBox()
    const sourceReportId = await nativeReportId(pluginAnalysis)
    expect(sourceReportId).not.toBeNull()
    let eqWindow = await openEqFit(application, pluginAnalysis)
    expect(eqWindow).not.toBe(pluginAnalysis)
    expect(
      await eqWindow.evaluate(() => ({
        desktop: typeof (window as unknown as Record<string, unknown>).heron,
        analysis: typeof (window as unknown as Record<string, unknown>).heronPluginAnalysis,
        eqFit: typeof (window as unknown as Record<string, unknown>).heronPluginAnalysisEqFit
      }))
    ).toEqual({ desktop: "undefined", analysis: "undefined", eqFit: "object" })
    const afterOpening = await chart.boundingBox()
    for (const coordinate of ["x", "y", "width", "height"] as const)
      expect(Math.abs(afterOpening![coordinate] - beforeOpening![coordinate])).toBeLessThanOrEqual(
        1
      )
    await expect(
      pluginAnalysis.getByRole("region", { name: "Parametric EQ fit", exact: true })
    ).toHaveCount(0)
    await expect(pluginAnalysis.getByText(/Fitted EQ/)).toHaveCount(0)
    // The native unity report exercises the child window's bundled module Worker
    // and real file:// CSP, beyond the browser-only synthetic bridge fixtures.
    const eqQuota = eqWindow.getByRole("spinbutton", { name: "EQ quota" })
    await expect(eqQuota).toHaveValue("3")
    await eqQuota.press("ArrowUp")
    await expect(eqQuota).toHaveValue("4")
    await eqWindow.getByRole("button", { name: "Fit EQ", exact: true }).click()
    let eqResult = eqWindow.getByRole("region", { name: "EQ fit result", exact: true })
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
    const fittedText = await eqResult.innerText()
    await pluginAnalysis.bringToFront()
    await eqLauncher.click()
    await expect
      .poll(
        () =>
          application.windows().filter((page) => page.url().includes("plugin-analysis-eq-fit.html"))
            .length
      )
      .toBe(1)
    expect(
      application.windows().find((page) => page.url().includes("plugin-analysis-eq-fit.html"))
    ).toBe(eqWindow)
    const nativeEqWindow = await application.browserWindow(eqWindow)
    await expect.poll(() => nativeEqWindow.evaluate((window) => window.isFocused())).toBe(true)
    await expect(eqQuota).toHaveValue("4")
    await expect(eqResult).toHaveText(fittedText, { useInnerText: true })
    await eqWindow.screenshot({
      path: test.info().outputPath("native-eq-fit.png"),
      fullPage: true,
      animations: "disabled"
    })
    await pluginAnalysis.screenshot({
      path: test.info().outputPath("analysis-with-eq-window.png"),
      fullPage: true
    })
    await signalPath.selectOption({ label: "R → R" })
    await expect(eqResult).toHaveCount(0)
    await expect(eqWindow.getByText("R → R", { exact: true })).toBeVisible()
    await expect(eqWindow.getByText("L → L", { exact: true })).toHaveCount(0)
    await expect(eqQuota).toHaveValue("4")
    expect(await nativeReportId(pluginAnalysis)).toBe(sourceReportId)
    await eqWindow.getByRole("button", { name: "Fit EQ", exact: true }).click()
    await expect(eqResult).toBeVisible()
    await eqWindow.close()
    await expect.poll(() => eqWindow.isClosed()).toBe(true)
    // Closing the child must leave the native analysis service/report alive.
    expect(await nativeReportId(pluginAnalysis)).toBe(sourceReportId)
    await signalPath.selectOption({ label: "L → L" })
    const previousEqWindow = eqWindow
    eqWindow = await openEqFit(application, pluginAnalysis)
    expect(eqWindow).not.toBe(previousEqWindow)
    eqResult = eqWindow.getByRole("region", { name: "EQ fit result", exact: true })
    await expect(eqResult).toHaveCount(0)
    await eqWindow.getByRole("button", { name: "Fit EQ", exact: true }).click()
    await expect(eqResult).toBeVisible()
    await signalPath.selectOption({ label: "L + R" })
    await expect(eqLauncher).toHaveCount(0)
    await expect(eqResult).toHaveCount(0)
    await expect(eqWindow.getByRole("button", { name: /^(Fit EQ|Fit again)$/ })).toHaveCount(0)
    await signalPath.selectOption({ label: "L → L" })
    await expect(eqLauncher).toBeVisible()
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
    await expect.poll(() => eqWindow.isClosed()).toBe(true)
    expect(main.isClosed()).toBe(false)
  } finally {
    await closeElectronApplication(application)
  }
})
