import { expect, type ElectronApplication, type Page } from "@playwright/test"

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
