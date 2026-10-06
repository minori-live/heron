import { expect, type ElectronApplication, type Page } from "@playwright/test"

/** Set up a fresh profile before testing a different product workflow. */
export async function completeWelcomeSetup(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Welcome to Heron", exact: true })).toBeHidden()
}

export async function dismissAutomaticTutorial(page: Page): Promise<void> {
  const overlay = page.locator(".driver-overlay")
  await overlay.waitFor({ state: "visible" })
  await page.keyboard.press("Escape")
  await expect(overlay).toBeHidden()
}

export async function closeElectronApplication(application: ElectronApplication): Promise<void> {
  const closed = await Promise.race([
    application.close().then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000))
  ])
  if (!closed) application.process().kill()
}

/**
 * Compare a layout measurement with the value the stylesheet specifies.
 *
 * `getBoundingClientRect` reports fractional values under a fractional device
 * pixel ratio, so a 282px section measures 281.9999694824219 on the Linux
 * runner while the layout is exactly right. Exact equality fails there and
 * would pass on an integral-scale machine, which makes the assertion depend on
 * the runner rather than on the layout.
 */
export function expectNear(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(0.01)
}
