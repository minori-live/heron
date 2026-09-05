import { expect, test } from "@playwright/test"

const story = (id: string) =>
  `/iframe.html?id=${id}&viewMode=story&globals=theme:dark;motion:disabled`

test("global track inputs retain compact heights, tempo precision and space for the denominator", async ({
  page
}) => {
  await page.goto(story("components-workspace-command-surfaces--global-track-fields"))
  const tempo = page.getByRole("spinbutton", { name: "Tempo" })
  const numerator = page.getByRole("spinbutton", { name: "Numerator" })
  const denominator = page.getByRole("combobox", { name: "Denominator" })
  await expect(denominator).toHaveValue("8") // The story's keyboard path has completed.
  await expect(tempo).toHaveValue("120.00")
  const tempoShell = tempo.locator("..")
  expect((await tempoShell.boundingBox())!.height).toBe(25)
  expect((await numerator.locator("..").boundingBox())!.height).toBe(23)
  const tempoBox = (await tempo.boundingBox())!
  const suffix = (await page.getByText("BPM", { exact: true }).boundingBox())!
  expect(tempoBox.height).toBe(23)
  expect(tempoBox.x + tempoBox.width).toBeLessThanOrEqual(suffix.x)
  expect(suffix.width).toBe(28)
  const top = (await numerator.boundingBox())!
  const bottom = (await denominator.boundingBox())!
  expect(top.width).toBeGreaterThan(60)
  expect(bottom.width).toBeGreaterThan(60)
  expect(top.x + top.width).toBeLessThan(bottom.x)
  expect(Math.abs(top.y + top.height / 2 - bottom.y - bottom.height / 2)).toBeLessThanOrEqual(1)
  const group = (await page.getByRole("group", { name: "Time signature" }).boundingBox())!
  expect(bottom.x + bottom.width).toBeLessThanOrEqual(group.x + group.width)
  await tempo.hover()
  await expect(tempo).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await tempo.focus()
  await expect(tempoShell).toHaveCSS("border-color", "rgb(101, 168, 255)")
  await tempo.fill("137.25")
  await tempo.press("Enter")
  await expect(tempo).toHaveValue("137.25")
  expect((await tempo.boundingBox())!.height).toBe(tempoBox.height)
  await page.setViewportSize({ width: 320, height: 800 })
  await expect(denominator).toBeInViewport()
  await expect(tempo).toBeInViewport()
})

test("track volume keeps the full meter well independent of gain, including silence", async ({
  page
}) => {
  await page.goto(story("components-workspace-mixer-controls--track-parameters"))
  const gain = page.getByRole("slider", { name: "Track volume" })
  const rail = page.locator(".ui-horizontal-fader__rail")
  const mask = page.locator(".ui-horizontal-fader__meter")
  await expect(gain).toBeVisible()
  await expect(gain).toHaveCSS("opacity", "1")
  expect((await rail.boundingBox())!.height).toBe(11)
  const originalMask = (await mask.boundingBox())!
  await gain.press("End")
  await expect(gain).toHaveValue("12")
  expect((await mask.boundingBox())!.x).toBe(originalMask.x)
  const bounds = (await gain.boundingBox())!
  await page.mouse.click(bounds.x + 1, bounds.y + bounds.height / 2)
  await expect(gain).toHaveValue("-90")
  expect((await mask.boundingBox())!.x).toBe(originalMask.x)
  await page.getByRole("button", { name: "Toggle signal" }).click()
  const well = (await rail.boundingBox())!
  await expect.poll(async () => (await mask.boundingBox())!.width).toBeCloseTo(well.width - 2, 0)
  expect((await mask.boundingBox())!.height).toBe(9)
  await page.getByRole("button", { name: "Toggle signal" }).click()
  await expect.poll(async () => (await mask.boundingBox())!.x).toBe(originalMask.x)
})

test("compact numeric editing stays inside its readout and pan retains double-click editing", async ({
  page
}) => {
  await page.goto(story("components-workspace-mixer-controls--track-parameters"))
  const gain = page.getByRole("button", { name: "Mixer gain" })
  await expect(gain).toBeVisible()
  const before = (await gain.boundingBox())!
  await gain.dblclick()
  const editor = page.getByRole("spinbutton", { name: "Mixer gain" })
  await expect(editor).toHaveValue("-90")
  const editing = (await editor.boundingBox())!
  expect(editing.width).toBeLessThanOrEqual(before.width)
  expect(editing.height).toBeLessThanOrEqual(20)
  await editor.fill("-3.5")
  await editor.press("Enter")
  await expect(gain).toBeFocused()
  await expect(gain).toHaveText("-3.5")
  const pan = page.getByRole("slider", { name: "Track pan" })
  await pan.dblclick()
  await expect(page.getByRole("spinbutton", { name: "Track pan value" })).toBeFocused()
  expect((await pan.boundingBox())!.width).toBe(23)
})

test("insert title uses the full row until hover then leaves room for actions", async ({
  page
}) => {
  await page.goto(story("components-workspace-mixer-controls--mixer-insert"))
  const row = page.getByRole("article", { name: "Compressor insert" })
  // Wait for the story's keyboard path to finish outside the insert before measuring rest.
  await expect(page.getByRole("button", { name: "After insert" })).toBeFocused()
  await page.mouse.move(800, 600)
  const title = row.locator(".ui-mixer-insert__content")
  const actions = row.locator(".ui-mixer-insert__actions")
  await expect(actions).toHaveCSS("opacity", "0")
  expect((await title.boundingBox())!.width).toBe((await row.boundingBox())!.width)
  await row.hover()
  await expect(actions).toHaveCSS("opacity", "1")
  const nameBounds = (await title.boundingBox())!
  const actionBounds = (await actions.boundingBox())!
  expect(nameBounds.x + nameBounds.width).toBeLessThanOrEqual(actionBounds.x + 1)
  await page.getByRole("button", { name: "Remove Compressor" }).focus()
  await page.mouse.move(800, 600)
  await expect(actions).toHaveCSS("opacity", "1")
})

test("audio fade handles remain visible and reachable above trim handles", async ({ page }) => {
  await page.goto(story("components-timeline--clip-editing"))
  const clip = page.getByRole("button", { name: "Audio clip Verse" })
  await expect(clip).toBeVisible()
  const bounds = (await clip.boundingBox())!
  const topHit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label"),
    { x: bounds.x + 4, y: bounds.y + 4 }
  )
  expect(topHit).toBe("Adjust Verse fade in")
  const bottomHit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label"),
    { x: bounds.x + 4, y: bounds.y + bounds.height - 4 }
  )
  expect(bottomHit).toBe("Trim Verse start")
  await expect(clip.locator(".ui-timeline-clip__heading")).toHaveCSS("height", "23px")
  await page.mouse.move(bounds.x + 4, bounds.y + 4)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 30, bounds.y + 4)
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect(page.getByText("fade-in:cancel", { exact: true })).toBeVisible()
})

test("settings keep neutral colors, icons and usable navigation at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto(story("components-boundary-contracts--settings-navigation"))
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" })
  const settings = page.getByRole("main")
  await expect(settings).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(1)
  const channels = await settings.evaluate((element) =>
    getComputedStyle(element)
      .backgroundColor.match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
  )
  expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(2)
  const device = page.getByRole("textbox", { name: "Device name" })
  const controlChannels = await device.evaluate((element) =>
    getComputedStyle(element)
      .backgroundColor.match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
  )
  expect(Math.max(...controlChannels) - Math.min(...controlChannels)).toBeLessThanOrEqual(2)
  await expect(page.getByRole("button", { name: "Back to studio" })).toBeInViewport()
  await page.getByRole("button", { name: "System", exact: true }).click()
  await page.getByRole("button", { name: /Display/ }).click()
  await expect(page.getByRole("heading", { name: "display" })).toBeInViewport()
  await expect(page.locator(".ui-settings-navigator__category-icon svg")).toHaveCount(2)
})
