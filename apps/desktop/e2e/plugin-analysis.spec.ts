import { expect, test, _electron as electron } from "@playwright/test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { closeElectronApplication } from "./support"

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
    await main.getByRole("menuitem", { name: "Help", exact: true }).click()
    await main.getByRole("menuitem", { name: /Plugin Analysis/ }).click()
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
    await expect(pluginAnalysis.getByRole("tab", { name: "Linear", exact: true })).toBeVisible({
      timeout: 45000
    })
    await expect(pluginAnalysis.getByText(/\+6\.0 dBFS/).first()).toBeVisible()
    for (const name of ["Harmonics", "Hammerstein", "Performance"]) {
      await pluginAnalysis.getByRole("tab", { name, exact: true }).click()
    }
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
