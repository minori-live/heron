import { expect, test } from "@playwright/test"

for (const theme of ["dark", "light"]) {
  test(`MIDI preferences preserve typography, selection and profile columns (${theme})`, async ({
    page
  }, testInfo) => {
    await page.goto(
      `/iframe.html?id=components-boundary-contracts--midi-preferences&viewMode=story&globals=theme:${theme};motion:disabled`
    )
    await expect(page.getByText("Editing Soft takeover", { exact: true })).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
    const yamaha = page.getByRole("button", { name: /Yamaha/ })
    const roland = page.getByRole("button", { name: /Roland/ })
    await expect(yamaha.locator("strong")).toHaveCSS("font-size", "9px")
    await expect(roland.locator("strong")).toHaveCSS("font-size", "9px")
    await expect(yamaha.locator("small")).toHaveCSS("font-size", "7px")
    const indicator = yamaha.locator(".ui-choice-card__indicator")
    const selectedColor = await indicator.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(selectedColor).not.toBe("rgba(0, 0, 0, 0)")
    await yamaha.hover()
    await expect(indicator).toHaveCSS("background-color", selectedColor)
    await roland.focus()
    await roland.press("Space")
    await expect(roland).toHaveAttribute("aria-pressed", "true")
    await expect(yamaha).toHaveAttribute("aria-pressed", "false")
    await expect(indicator).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await expect(roland.locator(".ui-choice-card__indicator")).toHaveCSS(
      "background-color",
      selectedColor
    )
    await expect(roland).toHaveCSS("outline-style", "solid")
    await page.getByRole("button", { name: "Browse folder" }).focus()
    await page.mouse.move(0, 0)
    await expect(roland).not.toBeFocused()
    await expect(roland).toHaveCSS("border-color", selectedColor)
    await expect(roland).toHaveCSS("box-shadow", `${selectedColor} 0px 0px 0px 1px inset`)
    await expect(yamaha).toHaveCSS("box-shadow", "none")
    await expect(page.getByRole("button", { name: "Browse folder" })).toHaveCSS("font-size", "8px")
    await expect(page.getByRole("button", { name: "Apply settings" })).toHaveCSS("font-size", "9px")
    const previewCard = page.getByRole("button", { name: /^Dark appearance/ })
    const previewBounds = (await previewCard.locator(".ui-choice-card__preview").boundingBox())!
    const previewTitle = (await previewCard.locator("strong").boundingBox())!
    expect(previewBounds.width).toBeGreaterThan(150)
    expect(previewBounds.height).toBe(72)
    expect(previewTitle.y).toBeGreaterThan(previewBounds.y + previewBounds.height)
    expect((await previewCard.locator("small").boundingBox())!.y).toBeGreaterThan(
      previewTitle.y + previewTitle.height
    )

    const row = page.getByRole("button", { name: /Soft takeover/ })
    const leading = (await row.locator(".ui-action-row__leading").boundingBox())!
    const copy = (await row.locator(".ui-action-row__copy").boundingBox())!
    const trailing = (await row.locator(".ui-action-row__trailing").boundingBox())!
    expect(leading.x + leading.width).toBeLessThan(copy.x)
    expect(copy.width).toBeGreaterThan(200)
    expect(copy.x + copy.width).toBeLessThan(trailing.x)
    await expect(row.locator("strong")).toHaveCSS("font-size", "9px")
    await expect(row.locator("small")).toHaveCSS("font-size", "7px")
    expect((await row.locator("small").boundingBox())!.y).toBeGreaterThan(
      (await row.locator("strong").boundingBox())!.y
    )
    await page.screenshot({ path: testInfo.outputPath("midi-preferences.png"), fullPage: true })

    await page.setViewportSize({ width: 320, height: 850 })
    const custom = page.getByRole("button", { name: /Relative custom/ })
    await custom.press("Enter")
    await expect(
      page.getByText("Editing Relative custom with a deliberately long controller profile name", {
        exact: true
      })
    ).toBeVisible()
    expect(await custom.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1)
  })
}
