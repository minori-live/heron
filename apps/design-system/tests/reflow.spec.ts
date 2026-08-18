import { expect, test } from "@playwright/test"

const reflowStories = [
  "product-examples-welcome--welcome",
  "product-examples-welcome--settings",
  "components-overlays-dialog--destructive-confirmation"
] as const

for (const id of reflowStories) {
  test(`${id} reflows at 320 CSS px and 200% text`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=theme:dark;motion:disabled`)
    await expect(page.locator(".storybook-stage")).toBeVisible()

    await page.addStyleTag({ content: "html { font-size: 200% !important; }" })
    const viewportOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(viewportOverflow).toBeLessThanOrEqual(1)
  })
}

test("mixer keeps two-dimensional overflow inside its workspace", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto(
    "/iframe.html?id=product-examples-welcome--mixer-controls&viewMode=story&globals=theme:dark;motion:disabled"
  )

  const localScroller = page.locator(".mixer-example-scroll")
  await expect(localScroller).toBeVisible()
  await expect
    .poll(() => localScroller.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true)
})

test("workspace toolbar keeps overflow local at 320 CSS px and 200% text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto(
    "/iframe.html?id=components-workspace-command-surfaces--editor-toolbar&viewMode=story&globals=theme:dark;motion:disabled"
  )

  await page.addStyleTag({ content: "html { font-size: 200% !important; }" })
  const toolbar = page.getByRole("toolbar", { name: "Piano roll commands" })
  await expect(toolbar).toBeVisible()
  await expect(page.getByRole("button", { name: "Close editor" })).toBeVisible()
  const viewportOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(viewportOverflow).toBeLessThanOrEqual(1)
})

test("dialog keeps long content scrolling inside its body", async ({ page }) => {
  await page.goto(
    "/iframe.html?id=components-overlays-dialog--scrollable-content&viewMode=story&globals=theme:dark;motion:disabled"
  )

  const dialog = page.getByRole("dialog", { name: "Benchmark results" })
  const scrollBody = dialog.locator(".ui-dialog__body")
  await expect(dialog).toHaveCSS("display", "grid")
  await expect(scrollBody).toHaveCSS("overflow-y", "auto")
  await expect
    .poll(() => scrollBody.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true)

  await scrollBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect.poll(() => scrollBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})

test("author-styled controls use flat solid borders without native bevels", async ({ page }) => {
  await page.goto(
    "/iframe.html?id=components-actions-button--default&viewMode=story&globals=theme:dark;motion:disabled"
  )
  await expect(page.getByRole("button", { name: "Save project" })).toHaveCSS(
    "border-top-style",
    "solid"
  )

  await page.goto(
    "/iframe.html?id=components-forms-field--complete-form&viewMode=story&globals=theme:dark;motion:disabled"
  )
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveCSS(
    "border-top-style",
    "solid"
  )
  await expect(page.getByRole("combobox", { name: "Audio driver" })).toHaveCSS(
    "border-top-style",
    "solid"
  )

  await page.goto(
    "/iframe.html?id=components-overlays-dialog--scrollable-content&viewMode=story&globals=theme:dark;motion:disabled"
  )
  const dialogHeader = page.getByRole("dialog", { name: "Benchmark results" }).locator("header")
  await expect(dialogHeader).toHaveCSS("border-bottom-width", "1px")
  await expect(dialogHeader).toHaveCSS("border-top-width", "0px")
  await expect(dialogHeader).toHaveCSS("border-left-width", "0px")
  await expect(dialogHeader).toHaveCSS("border-right-width", "0px")
})
