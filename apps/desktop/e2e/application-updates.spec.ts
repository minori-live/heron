import { expect, test, _electron as electron } from "@playwright/test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { closeElectronApplication } from "./support"

test("ordinary builds expose disabled updates through the real preload boundary", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "heron-updates-e2e-"))
  const executablePath = process.env.HERON_E2E_EXECUTABLE
  const application = await electron.launch({
    executablePath,
    args: [
      "--disable-gpu",
      "--no-sandbox",
      ...(executablePath ? [] : [resolve(import.meta.dirname, "..")])
    ],
    env: {
      ...process.env,
      HERON_TEST_USER_DATA: join(testRoot, "user-data"),
      HERON_TEST_MOCK_AUDIO: "1"
    }
  })
  try {
    await application.firstWindow()
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
    await page.getByRole("button", { name: "System", exact: true }).click()
    await page.getByRole("button", { name: /^Application updates/ }).click()
    await expect(page.getByRole("status")).toContainText("Automatic updates are unavailable")
    await expect(page.getByRole("button", { name: "Check for updates", exact: true })).toHaveCount(
      0
    )
    await page.screenshot({ path: test.info().outputPath("application-updates.png") })
  } finally {
    await closeElectronApplication(application)
  }
})
