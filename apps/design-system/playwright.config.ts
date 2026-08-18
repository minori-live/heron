import { defineConfig, devices } from "@playwright/test"

const storybookPort = Number(process.env.HERON_STORYBOOK_PORT ?? "6106")
const storybookUrl = `http://127.0.0.1:${storybookPort}`

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: storybookUrl,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark"
  },
  webServer: {
    command: `pnpm exec storybook dev --ci -p ${storybookPort}`,
    url: storybookUrl,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe"
  }
})
