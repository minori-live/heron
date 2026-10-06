import { expect, test, _electron as electron } from "@playwright/test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { closeElectronApplication } from "./support"

test("first-run choices preview, persist across reload, and allow diagnostics revocation", async () => {
  test.setTimeout(120_000)
  const testRoot = await mkdtemp(join(tmpdir(), "heron-welcome-e2e-"))
  const userData = join(testRoot, "user-data")
  const executablePath = process.env.HERON_E2E_EXECUTABLE
  const application = await electron.launch({
    executablePath,
    args: [
      ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
      "--disable-gpu",
      "--no-sandbox",
      ...(executablePath ? [] : [resolve(import.meta.dirname, "..")])
    ],
    env: { ...process.env, HERON_TEST_USER_DATA: userData, HERON_TEST_MOCK_AUDIO: "1" }
  })
  try {
    await expect
      .poll(() => application.windows().some((page) => page.url().includes("index.html")))
      .toBe(true)
    const page = application.windows().find((page) => page.url().includes("index.html"))!
    const welcome = page.getByRole("main")
    await expect(page.getByRole("heading", { name: "Welcome to Heron", exact: true })).toBeVisible()
    await expect(
      page.getByRole("checkbox", { name: "Allow sending crash reports to Sentry" })
    ).not.toBeChecked()
    // A requested workspace cannot replace setup before it is committed.
    await page.evaluate(() => {
      window.location.hash = "/settings/system"
    })
    await expect(page.getByRole("heading", { name: "Welcome to Heron", exact: true })).toBeVisible()
    for (const theme of ["Light", "Dark", "Follow system"] as const) {
      const option = welcome.getByRole("button", { name: new RegExp(`^${theme} `) })
      await option.click()
      await expect(option).toHaveAttribute("aria-pressed", "true")
      if (theme === "Dark")
        await page.screenshot({ path: test.info().outputPath("welcome-dark-en.png") })
      if (theme !== "Follow system")
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme.toLowerCase())
    }
    await welcome.getByRole("button", { name: /^Light / }).click()
    await welcome.getByRole("button", { name: /简体中文/ }).click()
    await expect(page.getByRole("heading", { name: "欢迎使用 Heron" })).toBeVisible()
    const welcomeConsent = page.getByRole("checkbox", { name: "允许向 Sentry 发送崩溃报告" })
    await welcomeConsent.focus()
    await welcomeConsent.press("Space")
    await expect(welcomeConsent).toBeChecked()
    // Appearance preview must not authorize reporting before Continue.
    const before = await page.evaluate(async () => {
      const result = await window.heron.bootstrap({
        protocolVersion: 2,
        requestId: crypto.randomUUID()
      })
      return result.ok ? result.value.settings.value.diagnosticsEnabled : null
    })
    expect(before).toBe(false)
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await welcome.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        false
      )
      await page.screenshot({ path: test.info().outputPath(`welcome-light-zh-${width}.png`) })
    }
    await page.getByRole("button", { name: "继续", exact: true }).click()
    await expect(page.getByRole("heading", { name: "欢迎使用 Heron" })).toBeHidden()
    const persisted = JSON.parse(await readFile(join(userData, "settings.json"), "utf8"))
    expect(persisted).toMatchObject({
      welcomeCompleted: true,
      diagnosticsEnabled: true,
      theme: "light",
      locale: "zh-cmn-Hans-CN"
    })
    await page.reload()
    await expect(page.getByRole("heading", { name: "系统设置", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "欢迎使用 Heron" })).toHaveCount(0)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
    await page.getByRole("button", { name: "显示", exact: true }).click()
    const consent = page.getByRole("checkbox", { name: "允许向 Sentry 发送崩溃报告" })
    await expect(consent).toBeChecked()
    await consent.focus()
    await consent.press("Space")
    await expect(consent).not.toBeChecked()
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(userData, "settings.json"), "utf8")).diagnosticsEnabled
      )
      .toBe(false)
    await page.reload()
    await expect(page.getByRole("heading", { name: "系统设置", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "显示", exact: true }).click()
    await expect(
      page.getByRole("checkbox", { name: "允许向 Sentry 发送崩溃报告" })
    ).not.toBeChecked()
  } finally {
    await closeElectronApplication(application)
  }
})
