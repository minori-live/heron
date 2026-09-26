import { test, expect, _electron as electron, type Page } from "@playwright/test"
import { mkdtemp, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { closeElectronApplication } from "./support"

async function expectWorkspaceGeometry(page: Page): Promise<void> {
  const geometry = await page.locator(".live-shell").evaluate((shell) => {
    const rect = (selector: string) => {
      const box = shell.querySelector(selector)!.getBoundingClientRect()
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom
      }
    }
    const bounds = shell.getBoundingClientRect()
    return {
      shell: { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom },
      top: rect(".topbar"),
      bottom: rect(".statusbar"),
      left: rect(".live-project-panel"),
      center: rect(".live-performance-workspace"),
      right: rect(".live-mixer-panel"),
      centerChildren: shell.querySelector(".live-performance-workspace")!.childElementCount,
      pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      topOverflows:
        shell.querySelector(".topbar")!.scrollWidth > shell.querySelector(".topbar")!.clientWidth
    }
  })
  expect(geometry.top.height).toBe(56)
  expect(geometry.bottom.height).toBe(25)
  expect(geometry.top.y).toBe(geometry.shell.y)
  expect(geometry.bottom.bottom).toBe(geometry.shell.bottom)
  expect(geometry.left.x).toBe(geometry.shell.x)
  expect(geometry.left.right).toBe(geometry.center.x)
  expect(geometry.center.right).toBe(geometry.right.x)
  expect(geometry.right.right).toBe(geometry.shell.right)
  expect(geometry.left.y).toBe(geometry.top.bottom)
  expect(geometry.center.y).toBe(geometry.top.bottom)
  expect(geometry.right.y).toBe(geometry.top.bottom)
  expect(geometry.right.bottom).toBe(geometry.bottom.y)
  expect(geometry.center.width).toBeGreaterThan(150)
  expect(geometry.centerChildren).toBe(0)
  expect(geometry.pageOverflows).toBe(false)
  expect(geometry.topOverflows).toBe(false)
  await expect(page.locator(".live-inspector, .track-inspector")).toHaveCount(0)
  await expect(page.locator(".live-mixer-panel .mixer-console")).toBeVisible()
}

async function setAppearance(
  page: Page,
  locale: "en-US" | "zh-cmn-Hans-CN",
  theme: "dark" | "light"
): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "/settings/system"
  })
  await page.getByRole("button", { name: /^(Display|显示)$/ }).click()
  await page
    .locator(".theme-options button")
    .filter({ has: page.locator(`.theme-preview-${theme}`) })
    .click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
  await page
    .locator(".locale-options button")
    .filter({ hasText: locale === "en-US" ? /^English/ : /^简体中文/ })
    .click()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const result = await window.heron.bootstrap({
          protocolVersion: 2,
          requestId: crypto.randomUUID()
        })
        if (!result.ok) throw new Error(result.error.code)
        return result.value.settings.value.locale
      })
    )
    .toBe(locale)
  await page.getByRole("button", { name: /^(Back to Live|返回 Live)$/ }).click()
  await expect(page.locator(".live-shell")).toBeVisible()
}

test("Live reuses the Studio shell and Mixer through editing, save, reopen and Studio switch", async () => {
  test.setTimeout(240_000)
  const root = await mkdtemp(join(tmpdir(), "heron-live-e2e-"))
  const path = join(root, "stage.hrl")
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
      HERON_TEST_USER_DATA: join(root, "user-data"),
      HERON_TEST_LIVE_PATH: path,
      HERON_TEST_PROJECT_PATH: join(root, "studio.hrs"),
      HERON_TEST_MOCK_AUDIO: "1"
    }
  })
  try {
    const page =
      application.windows().find((candidate) => !candidate.url().includes("splash.html")) ??
      (await application.waitForEvent("window", {
        predicate: (candidate) => !candidate.url().includes("splash.html")
      }))
    const rendererErrors: string[] = []
    page.on("pageerror", (error) => rendererErrors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") {
        rendererErrors.push(message.text().replace(/data:font\/[^']+/gu, "data:font/[embedded]"))
      }
    })
    page.setDefaultTimeout(20_000)
    await page.waitForLoadState("domcontentloaded")
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole("button", { name: "New Live" }).click()
    await expect(page.locator(".live-shell .live-document-title")).toContainText("Untitled Live")
    const mixer = page.locator(".live-mixer-panel .mixer-console")
    await expect(mixer.locator(".channel-strip")).toHaveCount(3)
    await expect(mixer.getByRole("button", { name: "Undo mixer change" })).toBeDisabled()
    await expect(mixer.getByRole("button", { name: "Redo mixer change" })).toBeDisabled()
    await expectWorkspaceGeometry(page)
    await expect(mixer.getByRole("button", { name: /^Arm / })).toHaveCount(0)
    await expect(mixer.getByRole("button", { name: /^Bounce / })).toHaveCount(0)

    const originalName = mixer.getByRole("button", {
      name: "Audio 1 channel name; double-click to rename"
    })
    await originalName.focus()
    await originalName.press("F2")
    await mixer.getByRole("textbox", { name: "Rename Audio 1" }).fill("Voice")
    await mixer.getByRole("textbox", { name: "Rename Audio 1" }).press("Enter")
    const voice = mixer.getByRole("article", { name: "Voice audio channel", exact: true })
    await expect(voice).toBeVisible()
    await mixer.getByRole("button", { name: "Add aux channel" }).click()
    await expect(mixer.locator(".channel-strip")).toHaveCount(4)
    await mixer.getByRole("button", { name: "Add instrument channel" }).click()
    await expect(mixer.locator(".channel-strip")).toHaveCount(5)
    await mixer.getByRole("button", { name: "Undo mixer change" }).click()
    await expect(mixer.locator(".channel-strip")).toHaveCount(4)
    await mixer.getByRole("button", { name: "Redo mixer change" }).click()
    await expect(mixer.locator(".channel-strip")).toHaveCount(5)

    await voice.getByRole("button", { name: "Add send in empty slot" }).click()
    await page.getByRole("menuitem", { name: "Buses", exact: true }).focus()
    await page.getByRole("menuitem", { name: "Buses", exact: true }).press("ArrowRight")
    await page.getByRole("menuitemradio", { name: "BUS 1", exact: true }).click()
    await expect(voice.locator(".send-row:not(.empty):not(.alignment-spacer)")).toHaveCount(1)
    await voice.getByRole("button", { name: "Add send in empty slot" }).click()
    await page.getByRole("menuitem", { name: "Outputs", exact: true }).focus()
    await page.getByRole("menuitem", { name: "Outputs", exact: true }).press("ArrowRight")
    await page.getByRole("menuitemradio", { name: /Output/ }).click()
    await expect(voice.locator(".send-row:not(.empty):not(.alignment-spacer)")).toHaveCount(2)
    await voice.getByRole("button", { name: "Edit send to BUS 1", exact: true }).click()
    await page.getByRole("button", { name: "Disable send", exact: true }).click()
    await expect(page.getByRole("button", { name: "Enable send", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(voice.locator(".send-row.disabled")).toHaveCount(1)

    const resize = page.getByRole("separator", { name: "Resize Mixer", exact: true })
    await resize.focus()
    await resize.press("ArrowLeft")
    await expect(resize).toHaveAttribute("aria-valuenow", "530")
    await page.keyboard.press("m")
    await expect(page.locator(".live-mixer-panel")).toHaveCount(0)
    await page.keyboard.press("m")
    await expect(resize).toHaveAttribute("aria-valuenow", "530")
    const handle = (await resize.boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 100)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + 100)
    await expect(resize).toHaveAttribute("aria-valuenow", "470")
    await page.keyboard.press("Escape")
    await page.mouse.up()
    await expect(resize).toHaveAttribute("aria-valuenow", "530")
    await resize.press("Home")
    await expect(resize).toHaveAttribute("aria-valuenow", "520")

    const devicesButton = page
      .locator(".topbar")
      .getByRole("button", { name: "Audio & MIDI devices", exact: true })
    await devicesButton.click()
    const devicesDialog = page.getByRole("dialog", { name: "Audio & MIDI devices", exact: true })
    await expect(devicesDialog).toBeVisible()
    const sampleRate = devicesDialog.getByRole("spinbutton", { name: "Sample rate", exact: true })
    await sampleRate.focus()
    await expect(sampleRate).toBeFocused()
    await sampleRate.fill("96000")
    await sampleRate.press("Tab")
    await page.screenshot({ path: test.info().outputPath("live-devices-en.png") })
    await page.keyboard.press("Escape")
    await expect(devicesDialog).toBeHidden()
    await expect(devicesButton).toBeFocused()
    await devicesButton.click()
    await expect(sampleRate).toHaveValue("48,000")
    await page.keyboard.press("Escape")

    for (const locale of ["en-US", "zh-cmn-Hans-CN"] as const) {
      for (const theme of ["dark", "light"] as const) {
        await setAppearance(page, locale, theme)
        await expect(page.locator(".topbar")).toContainText(locale === "en-US" ? "Edit" : "编辑")
        for (const width of [1440, 960]) {
          await page.setViewportSize({ width, height: width === 1440 ? 900 : 640 })
          await expectWorkspaceGeometry(page)
          await page.screenshot({
            path: test.info().outputPath(`live-${locale}-${theme}-${width}.png`)
          })
        }
        await page.setViewportSize({ width: 1440, height: 900 })
      }
    }
    await setAppearance(page, "en-US", "dark")
    await page
      .locator(".topbar")
      .getByRole("button", { name: /^Save project$/i })
      .click()
    await expect(page.getByLabel("Unsaved changes", { exact: true })).toHaveCount(0)
    await expect.poll(async () => (await stat(path)).size).toBeGreaterThan(0)
    await page
      .locator(".topbar")
      .getByRole("button", { name: /^Close project$/i })
      .click()
    await expect(page.getByRole("button", { name: "New Live" })).toBeVisible()
    await page.locator(".recent-item").filter({ hasText: "Untitled Live" }).click()
    await expect(mixer.locator(".channel-strip")).toHaveCount(5)
    await expect(voice).toBeVisible()
    await expect(voice.locator(".send-row:not(.empty):not(.alignment-spacer)")).toHaveCount(2)
    await expect(voice.locator(".send-row.disabled")).toHaveCount(1)
    await expectWorkspaceGeometry(page)
    await page
      .locator(".topbar")
      .getByRole("button", { name: /^Close project$/i })
      .click()
    await page.getByRole("button", { name: "New Studio" }).click()
    await expect(page.locator(".studio-shell.document-workspace-shell")).toBeVisible()
    expect(rendererErrors).toEqual([])
  } finally {
    await closeElectronApplication(application)
  }
})
