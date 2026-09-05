import { test, expect, _electron as electron } from "@playwright/test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { closeElectronApplication, dismissAutomaticTutorial } from "./support"

test("settings retain persistent selection outlines, dense buttons and stacked previews", async () => {
  const testInfo = test.info()
  test.setTimeout(120_000)
  const testRoot = await mkdtemp(join(tmpdir(), "heron-settings-visual-"))
  const audioName = "Drum loop with a long descriptive filename.wav"
  const audioPath = join(testRoot, audioName)
  const wave = Buffer.alloc(44 + 9_600)
  wave.write("RIFF", 0)
  wave.writeUInt32LE(wave.length - 8, 4)
  wave.write("WAVEfmt ", 8)
  wave.writeUInt32LE(16, 16)
  wave.writeUInt16LE(1, 20)
  wave.writeUInt16LE(1, 22)
  wave.writeUInt32LE(48_000, 24)
  wave.writeUInt32LE(96_000, 28)
  wave.writeUInt16LE(2, 32)
  wave.writeUInt16LE(16, 34)
  wave.write("data", 36)
  wave.writeUInt32LE(9_600, 40)
  await writeFile(audioPath, wave)
  const executablePath = process.env.HERON_E2E_EXECUTABLE
  const application = await electron.launch({
    executablePath,
    args: [
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--no-sandbox",
      ...(executablePath ? [] : [resolve(import.meta.dirname, "..")])
    ],
    env: {
      ...process.env,
      HERON_TEST_USER_DATA: join(testRoot, "user-data"),
      HERON_TEST_PROJECT_PATH: join(testRoot, "typography.heron"),
      HERON_TEST_CAPTURE_SOURCE: "1",
      HERON_TEST_MOCK_AUDIO: "1"
    }
  })
  application.process().stderr?.on("data", (data) => console.log(`main stderr: ${String(data)}`))
  try {
    const firstWindow = await application.firstWindow()
    await firstWindow.waitForLoadState("domcontentloaded")
    const page =
      application.windows().find((candidate) => candidate.url().includes("index.html")) ??
      (await application.waitForEvent("window", {
        predicate: (candidate) => !candidate.url().includes("splash.html")
      }))
    await page.waitForLoadState("domcontentloaded")
    await expect(page.getByRole("button", { name: "Start creating", exact: true })).toBeVisible()
    await page.evaluate(() => {
      window.location.hash = "/settings/system"
    })
    await expect(page.getByRole("heading", { name: "System settings" })).toBeVisible()
    const backend = page.getByRole("group", { name: "Audio backend" })
    const backendTitle = backend.locator(".ui-radio-group__label").first()
    const backendDescription = backend.locator(".ui-radio-group__description").first()
    await expect(backendTitle).toHaveCSS("font-size", "9px")
    await expect(backendTitle).toHaveCSS("font-family", /Inter Variable/)
    await expect(backendDescription).toHaveCSS("font-size", "7px")
    expect((await backendDescription.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await backendTitle.boundingBox())!.y + (await backendTitle.boundingBox())!.height
    )
    expect((await backend.getByRole("radio").first().boundingBox())!.width).toBe(12)
    await page.screenshot({ path: testInfo.outputPath("backend.png") })
    await page.getByRole("button", { name: "System", exact: true }).click()
    const save = page.getByRole("button", { name: "Save for next launch" })
    await expect(save).toHaveCSS("font-size", "9px")
    await page.getByRole("button", { name: "Display", exact: true }).click()
    for (const theme of ["Light", "Dark"]) {
      const selected = page.getByRole("button", { name: new RegExp(`^${theme} `) })
      await selected.click()
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme.toLowerCase())
      await page.getByRole("button", { name: "Back to welcome" }).focus()
      await page.mouse.move(0, 0)
      await expect(selected).toHaveAttribute("aria-pressed", "true")
      await expect(selected).not.toBeFocused()
      expect(await selected.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset")
      const preview = (await selected.locator(".theme-preview").boundingBox())!
      const title = (await selected.locator("strong").boundingBox())!
      const description = (await selected.locator("small").boundingBox())!
      expect(preview.height).toBe(72)
      expect(preview.width).toBeGreaterThan(100)
      expect(title.y).toBeGreaterThan(preview.y + preview.height)
      expect(description.y).toBeGreaterThan(title.y + title.height)
      await page.screenshot({ path: testInfo.outputPath(`display-${theme}.png`) })
    }
    await page.getByRole("button", { name: "MIDI", exact: true }).click()
    const yamaha = page.getByRole("button", { name: /^Yamaha/ })
    await yamaha.click()
    await page.getByRole("button", { name: "Back to welcome" }).focus()
    await expect(yamaha).toHaveAttribute("aria-pressed", "true")
    expect(await yamaha.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset")
    await page.getByRole("button", { name: /MIDI Controls/ }).click()
    const row = page.locator(".profile-list button").first()
    await expect(row).toBeVisible()
    const title = (await row.locator("strong").boundingBox())!
    expect((await row.locator("small").boundingBox())!.y).toBeGreaterThan(title.y + title.height)
    await page.getByRole("button", { name: "Back to welcome" }).click()
    await page.getByRole("button", { name: "Start creating" }).click()
    await expect(page.locator(".studio-shell")).toBeVisible({ timeout: 90_000 })
    await dismissAutomaticTutorial(page)
    const mixer = page.getByRole("button", { name: "Mixer", exact: true })
    if ((await mixer.getAttribute("aria-pressed")) !== "true") await mixer.click()
    const globalTracks = page.getByRole("button", { name: /(?:Hide|Show) global tracks/ })
    const input = page
      .locator(".mixer-console:visible")
      .getByRole("button", { name: "Audio 1 input channel" })
    const routes = page.locator(
      ".mixer-console:visible .output-section .ui-cascading-select, .mixer-console:visible .output-control"
    )
    await expect(input).toBeVisible()
    await page.evaluate(async () => {
      const bootstrap = await window.heron.bootstrap({
        protocolVersion: 2,
        requestId: crypto.randomUUID()
      })
      if (!bootstrap.ok) throw new Error(bootstrap.error.code)
      const started = await window.heron.startAudioEngine(
        {
          protocolVersion: 2,
          requestId: crypto.randomUUID(),
          target: bootstrap.value.audioResources.host,
          mutation: { operationId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }
        },
        {
          backend: "mock",
          inputDeviceId: "custom:mock-duplex",
          outputDeviceId: "custom:mock-duplex",
          bufferSize: 256
        }
      )
      if (!started.ok) throw new Error(started.error.code)
    })
    const monitorTarget = page.getByRole("button", {
      name: "Set Output 1–2 as the Low Latency Mode monitoring target",
      exact: true
    })
    await expect(monitorTarget).toBeEnabled()
    await monitorTarget.click()
    await expect(monitorTarget).toHaveAttribute("aria-pressed", "true")
    await mixer.focus()
    await page.mouse.move(0, 0)
    await expect(monitorTarget).toHaveCSS("color", "rgb(89, 215, 154)")
    await expect.poll(() => monitorTarget.evaluate((el) => el.getAnimations().length)).toBe(0)
    expect(await monitorTarget.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset")
    const selectedBorder = await monitorTarget.evaluate((el) => getComputedStyle(el).borderColor)
    const selectedBackground = await monitorTarget.evaluate(
      (el) => getComputedStyle(el).backgroundColor
    )
    await monitorTarget.hover()
    await expect(monitorTarget).toHaveCSS("border-color", selectedBorder)
    await expect(monitorTarget).toHaveCSS("background-color", selectedBackground)
    for (const control of [globalTracks, input, ...(await routes.all())]) {
      await expect(control).toHaveCSS("font-size", "8px")
      await expect(control).toHaveCSS("font-family", /Cascadia Mono/)
      await expect(control).toHaveCSS("font-weight", "400")
    }
    const performance = page.locator(".performance-trigger")
    await expect(performance).toHaveCSS("font-size", "7px")
    await expect(performance).toHaveCSS("font-family", /Cascadia Mono/)
    await expect(performance).toHaveCSS("font-weight", "400")
    expect((await performance.boundingBox())!.height).toBe(20)
    expect((await globalTracks.boundingBox())!.height).toBe(27)
    await globalTracks.click()
    await expect(globalTracks).toHaveAttribute("aria-pressed", "false")
    await globalTracks.press("Enter")
    await expect(globalTracks).toHaveAttribute("aria-pressed", "true")
    await page.screenshot({ path: testInfo.outputPath("studio-typography.png") })
    const quickControls = page.locator(".track-quick-controls").first()
    const stateButtons = quickControls.locator(".ui-mixer-state-button")
    await expect(stateButtons).toHaveCount(4)
    let previousRight = 0
    for (const button of await stateButtons.all()) {
      const box = (await button.boundingBox())!
      expect(box.width).toBe(17)
      expect(box.height).toBe(17)
      if (previousRight) expect(box.x - previousRight).toBeGreaterThanOrEqual(2)
      previousRight = box.x + box.width
    }
    const gain = quickControls.getByRole("slider", { name: "Audio 1 quick volume" })
    const gainBox = (await gain.boundingBox())!
    expect(gainBox.x - previousRight).toBeGreaterThanOrEqual(2)
    expect(gainBox.width).toBeGreaterThanOrEqual(64)
    await page.getByRole("button", { name: "Media Browser", exact: true }).click()
    const browser = page.locator("[data-media-browser]")
    const search = browser.getByRole("searchbox")
    await search.fill("D")
    const searchShell = search.locator("..")
    expect((await searchShell.boundingBox())!.height).toBe(27)
    await expect(search).toHaveCSS("outline-style", "none")
    await expect(search).toHaveCSS("box-shadow", "none")
    const shellBox = (await searchShell.boundingBox())!
    const searchBox = (await search.boundingBox())!
    expect(searchBox.y).toBeGreaterThanOrEqual(shellBox.y)
    expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(shellBox.y + shellBox.height)
    const filters = browser.locator(".filter-row")
    expect((await filters.boundingBox())!.y - shellBox.y - shellBox.height).toBeGreaterThanOrEqual(
      6
    )
    await expect(filters.locator(".ui-segmented")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await page.screenshot({ path: testInfo.outputPath("media-and-track-controls.png") })
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, audioPath)
    await browser.locator(".import-row").getByRole("button", { name: "Audio", exact: true }).click()
    await search.fill("")
    const asset = browser.getByRole("button", {
      name: new RegExp(`^Drum loop with a long descriptive filename`)
    })
    await expect(asset).toBeVisible()
    const assetTitle = asset.locator("strong")
    const assetDetail = asset.locator("small")
    const titleBox = (await assetTitle.boundingBox())!
    expect(titleBox.width).toBeGreaterThan(100)
    expect((await assetDetail.boundingBox())!.y).toBeGreaterThanOrEqual(
      titleBox.y + titleBox.height
    )
    const audition = browser.getByRole("button", { name: `Audition ${audioName}`, exact: true })
    const assetBox = (await asset.boundingBox())!
    expect((await audition.boundingBox())!.x).toBeGreaterThanOrEqual(assetBox.x + assetBox.width)
    await asset.click()
    await expect(asset).toHaveAttribute("aria-current", "true")
    await audition.click()
    await expect(
      browser.getByRole("button", { name: `Stop auditioning ${audioName}`, exact: true })
    ).toBeVisible()
    await browser
      .getByRole("button", { name: `Stop auditioning ${audioName}`, exact: true })
      .click()
    await page.screenshot({ path: testInfo.outputPath("media-asset-layout.png") })
    await page.evaluate(async () => {
      const bootstrap = await window.heron.bootstrap({
        protocolVersion: 2,
        requestId: crypto.randomUUID()
      })
      if (!bootstrap.ok || !bootstrap.value.workspace) throw new Error("Test workspace unavailable")
      const closed = await window.heron.closeProject(
        {
          protocolVersion: 2,
          requestId: crypto.randomUUID(),
          target: bootstrap.value.workspace.project,
          mutation: { operationId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }
        },
        "discard"
      )
      if (!closed.ok || !closed.value.closed) throw new Error("Test workspace did not close")
      if (bootstrap.value.audioResources.engine) {
        const stopped = await window.heron.stopAudioEngine({
          protocolVersion: 2,
          requestId: crypto.randomUUID(),
          target: bootstrap.value.audioResources.engine,
          mutation: { operationId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }
        })
        if (!stopped.ok) throw new Error(stopped.error.code)
      }
    })
  } finally {
    await closeElectronApplication(application)
  }
})
