import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { extname, resolve } from "node:path"
import type { PluginAnalysisSnapshot, PluginDescriptor } from "@heron/contracts"
import { analysisSnapshot } from "../src/renderer/src/test/plugin-analysis"

// Exercise the real built renderer and CSS without an audio device or Electron.
// The IPC fixture supplies product state; Chromium owns layout and computed colors.
const renderer = resolve(import.meta.dirname, "../out/renderer")
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml"
}

async function expectAnalysisLayout(page: Page): Promise<void> {
  const layout = await page.locator(".plugin-analysis-chain").evaluate((chain) => {
    const rack = chain.querySelector(".rack")!.getBoundingClientRect()
    const workspace = chain.closest(".workspace")!.getBoundingClientRect()
    const panel = chain.getBoundingClientRect()
    const inserts = chain.querySelector('[data-section="plugins"]')!.getBoundingClientRect()
    const report = (
      document.querySelector(".settings-panel") ?? document.querySelector(".analysis")!
    ).getBoundingClientRect()
    return {
      panelBottomGap: workspace.bottom - panel.bottom,
      reportRightGap: workspace.right - report.right,
      rackInsideGap: Math.min(rack.left - panel.left, panel.right - rack.right),
      insertsBottomGap: rack.bottom - inserts.bottom,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth
    }
  })
  // The sidebar spans the workspace, the rack hugs its slots, and the report never clips.
  expect(Math.abs(layout.panelBottomGap)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.reportRightGap)).toBeLessThanOrEqual(1)
  expect(layout.rackInsideGap).toBeGreaterThanOrEqual(8)
  expect(layout.insertsBottomGap).toBeLessThanOrEqual(2)
  expect(layout.pageOverflow).toBeLessThanOrEqual(0)
}

async function expectReadableAnalysisText(page: Page): Promise<void> {
  const contrasts = await page
    .locator(
      ".rack-heading > span, .rack-heading button, .status-label, .conditions, .plot-title, .legend > span"
    )
    .evaluateAll((elements) => {
      const luminance = (color: string): number => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
        const linear = channels.map((channel) => {
          const value = channel / 255
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
      }
      return elements.map((element) => {
        let surface: Element | null = element
        while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") {
          surface = surface.parentElement
        }
        const foreground = luminance(getComputedStyle(element).color)
        const background = luminance(getComputedStyle(surface!).backgroundColor)
        return {
          text: element.textContent || element.getAttribute("aria-label"),
          contrast:
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        }
      })
    })
  expect(contrasts.length).toBeGreaterThanOrEqual(4)
  for (const { text, contrast } of contrasts)
    expect(contrast, `${text} contrast`).toBeGreaterThanOrEqual(4.5)
}

async function openAnalysis(page: Page, initial: PluginAnalysisSnapshot): Promise<void> {
  await page.route("http://localhost/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    await route.fulfill({
      body: await readFile(resolve(renderer, `.${path}`)),
      contentType: mime[extname(path)] ?? "application/octet-stream"
    })
  })
  await page.addInitScript((initial) => {
    let snapshot = initial
    Object.defineProperty(window, "heronPluginAnalysis", {
      value: {
        platform: "win32",
        snapshot: async () => ({ ok: true, value: snapshot }),
        setEqFitSelection: async (_meta: unknown, request: { sequence: number }) => ({
          ok: true,
          value: { sequence: request.sequence, selectionRevision: request.sequence, opened: false }
        }),
        command: async (_meta: unknown, command: { type: string; enabled: boolean }) => {
          if (command.type === "comparison")
            snapshot = { ...snapshot, comparisonEnabled: command.enabled }
          return { ok: true, value: snapshot }
        }
      }
    })
  }, initial)
  await page.goto("http://localhost/plugin-analysis.html")
  await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeVisible()
}

test("analysis layout reflows without clipping and its text stays readable after theme changes", async ({
  page
}) => {
  await openAnalysis(page, analysisSnapshot())
  for (const [width, height] of [
    [1200, 700],
    [1200, 1000],
    [900, 600]
  ]) {
    await page.setViewportSize({ width, height })
    await expectAnalysisLayout(page)
  }
  for (const theme of ["light", "dark", "light"]) {
    await page.locator("html").evaluate((element, theme) => {
      element.dataset.theme = theme
    }, theme)
    await expectReadableAnalysisText(page)
    await page.screenshot({ path: test.info().outputPath(`analysis-${theme}.png`) })
  }
  const compare = page.getByRole("checkbox", { name: "Compare chains" })
  await compare.focus()
  await compare.press("Space")
  await expect(compare).toBeChecked()
  await expectAnalysisLayout(page)
  const settings = page.getByRole("button", { name: "Measurement settings" })
  await settings.click()
  await expect(page.getByRole("complementary", { name: "Measurement settings" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Linear", exact: true })).toBeVisible()
  await expectAnalysisLayout(page)
  // Closing from inside the panel returns keyboard focus to the control that opened it.
  await page.getByRole("button", { name: "Close measurement settings" }).press("Enter")
  await expect(page.getByRole("complementary", { name: "Measurement settings" })).toHaveCount(0)
  await expect(settings).toBeFocused()
})

test("a full analysis chain scrolls within the sidebar in a short window", async ({ page }) => {
  const descriptor: PluginDescriptor = {
    source: { kind: "external" },
    locator: { format: "vst3", artifactPath: "/fixture.vst3", nativeId: "fixture" },
    name: "Effect",
    vendor: "Heron",
    version: "1",
    categories: ["Fx"],
    kind: "effect",
    supportedAudioModes: ["stereo"],
    architecture: "x86_64",
    buses: [],
    hasEditor: true,
    compatibility: "compatible",
    compatibilityReason: null
  }
  const snapshot = analysisSnapshot()
  snapshot.plugins = Array.from({ length: 16 }, (_, slotOrder) => ({
    id: `effect-${slotOrder}`,
    channelId: snapshot.ref.id,
    role: "insert",
    slotOrder,
    locator: descriptor.locator,
    descriptor: { ...descriptor, name: `Effect ${slotOrder + 1}` },
    audioMode: "stereo",
    enabled: true,
    sidechainInputs: [],
    state: { version: 1, chunks: [] }
  }))
  await page.setViewportSize({ width: 1200, height: 380 })
  await openAnalysis(page, snapshot)
  const last = page.getByRole("button", { name: "Open Effect 16 editor", exact: true })
  await last.scrollIntoViewIfNeeded()
  const chain = page.locator(".plugin-analysis-chain")
  const scrolling = await chain.evaluate((element) => ({
    overflow: element.scrollHeight > element.clientHeight,
    top: element.scrollTop
  }))
  expect(scrolling.overflow).toBe(true)
  expect(scrolling.top).toBeGreaterThan(0)
  const panel = (await chain.boundingBox())!
  const row = (await last.boundingBox())!
  expect(row.y + row.height).toBeLessThanOrEqual(panel.y + panel.height)
})
