import { expect, test as base, type Locator, type Page } from "@playwright/test"
import { readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve, sep } from "node:path"
import type { PluginAnalysisReport, PluginAnalysisSnapshot } from "@heron/contracts"
import { analysisReport, analysisSnapshot } from "../src/renderer/src/test/plugin-analysis"

// TEST ONLY: deterministic synthetic raw bins. No fitter code generates these
// values; the independently written RBJ Bell is +6 dB at 1 kHz, Q=1.2, 48 kHz.
function syntheticReport(overallGain = 1.5, bell = true): PluginAnalysisReport {
  const report = analysisReport()
  const frequency = Array.from({ length: 384 }, (_, i) => 20 * 1000 ** (i / 383))
  const omega = (2 * Math.PI * 1000) / 48000
  const amplitude = 10 ** (6 / 40)
  const alpha = Math.sin(omega) / (2 * 1.2)
  const numerator = [1 + alpha * amplitude, -2 * Math.cos(omega), 1 - alpha * amplitude]
  const denominator = [1 + alpha / amplitude, -2 * Math.cos(omega), 1 - alpha / amplitude]
  const power = (coefficients: number[], angle: number): number =>
    (coefficients[0] + coefficients[1] * Math.cos(angle) + coefficients[2] * Math.cos(2 * angle)) **
      2 +
    (coefficients[1] * Math.sin(angle) + coefficients[2] * Math.sin(2 * angle)) ** 2
  const magnitude = frequency.map((hz) => {
    const angle = (2 * Math.PI * hz) / 48000
    return (
      overallGain +
      (bell ? 10 * Math.log10(power(numerator, angle) / power(denominator, angle)) : 0)
    )
  })
  report.responses = [
    { input: 0, output: 0, magnitude_db: magnitude },
    { input: 1, output: 1, magnitude_db: frequency.map(() => -3) },
    { input: 0, output: 1, magnitude_db: frequency.map(() => -12) },
    { input: 1, output: 0, magnitude_db: frequency.map(() => -8) }
  ].map((path) => ({
    ...path,
    frequency_hz: [...frequency],
    phase_degrees: frequency.map(() => 0),
    impulse: [1],
    impulse_stride: 1,
    impulse_start_samples: 0,
    delay_samples: 0,
    tail_truncated: false,
    silence_rms: 0,
    repeat_error_percent: 0
  }))
  return report
}

interface RendererServer {
  url: string
  holdWorkers(): void
  releaseWorkers(): void
  workerRequests(): number
}

// A real HTTP origin is necessary for built Worker scripts: page.route does not
// provide a network server for requests made outside the main page. Holding a
// worker script tests cancellation before completion without replacing Worker.
const test = base.extend<{ rendererServer: RendererServer }>({
  rendererServer: async ({ browserName: _browserName }, use) => {
    const renderer = resolve(import.meta.dirname, "../out/renderer")
    const mime: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".woff2": "font/woff2",
      ".svg": "image/svg+xml"
    }
    let gate: Promise<void> | undefined
    let release: (() => void) | undefined
    let requests = 0
    const server = createServer((request, response) => {
      void (async () => {
        const path = resolve(renderer, `.${new URL(request.url!, "http://localhost").pathname}`)
        if (!path.startsWith(`${renderer}${sep}`)) {
          response.writeHead(403).end()
          return
        }
        if (request.headers["sec-fetch-dest"] === "worker") {
          requests += 1
          await gate
        }
        try {
          const content = await readFile(path)
          response.writeHead(200, {
            "Content-Type": mime[extname(path)] ?? "application/octet-stream",
            "Cache-Control": "no-store"
          })
          response.end(content)
        } catch {
          response.writeHead(404).end()
        }
      })()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Renderer server did not listen")
    try {
      await use({
        url: `http://127.0.0.1:${address.port}`,
        holdWorkers() {
          gate = new Promise<void>((resolve) => {
            release = resolve
          })
        },
        releaseWorkers() {
          release?.()
          gate = undefined
        },
        workerRequests: () => requests
      })
    } finally {
      release?.()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
})

async function openAnalysis(
  page: Page,
  server: RendererServer,
  initial = analysisSnapshot({ report: syntheticReport() })
): Promise<void> {
  await page.addInitScript((initial) => {
    let snapshot = initial
    Object.defineProperty(window, "setEqTestSnapshot", {
      value: (next: typeof initial) => {
        snapshot = next
      }
    })
    Object.defineProperty(window, "heronPluginAnalysis", {
      value: {
        platform: "win32",
        snapshot: async () => ({ ok: true, value: snapshot }),
        command: async (_meta: unknown, command: { type: string; enabled: boolean }) => {
          if (command.type === "comparison")
            snapshot = { ...snapshot, comparisonEnabled: command.enabled }
          if (command.type === "repeat") snapshot = { ...snapshot, repeating: command.enabled }
          return { ok: true, value: snapshot }
        }
      }
    })
  }, initial)
  await page.goto(`${server.url}/plugin-analysis.html`)
  await expect(page.getByRole("button", { name: "Fit EQ", exact: true })).toBeVisible()
}

async function replaceSnapshot(page: Page, snapshot: PluginAnalysisSnapshot): Promise<void> {
  await page.evaluate((snapshot) => {
    const api = window as unknown as { setEqTestSnapshot(value: typeof snapshot): void }
    api.setEqTestSnapshot(snapshot)
  }, snapshot)
}

async function metric(result: Locator, label: string): Promise<number> {
  const text = await result
    .getByText(label, { exact: true })
    .evaluate((element) => element.nextElementSibling!.textContent.replaceAll("−", "-"))
  return Number.parseFloat(text)
}

async function fit(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^(Fit EQ|Fit again)$/ }).click()
  const result = page.getByRole("region", { name: "EQ fit result", exact: true })
  await expect(result).toBeVisible()
  return result
}

test("built worker fits raw bins and keeps its controls and result readable at narrow widths", async ({
  page,
  rendererServer
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1280, height: 1000 })
  await openAnalysis(page, rendererServer)
  const quota = page.getByRole("spinbutton", { name: "EQ quota" })
  await expect(quota).toHaveValue("3")
  const fitButton = page.getByRole("button", { name: "Fit EQ", exact: true })
  await expect(fitButton).toBeDisabled()
  await page
    .getByRole("combobox", { name: "Input → output", exact: true })
    .selectOption({ label: "L → L" })
  await fitButton.focus()
  await fitButton.press("Enter")
  const result = page.getByRole("region", { name: "EQ fit result", exact: true })
  await expect(result).toBeVisible()
  expect(rendererServer.workerRequests()).toBe(1)
  expect(await metric(result, "Overall Gain")).toBeCloseTo(1.5, 1)
  expect(await metric(result, "RMS error")).toBeLessThan(0.1)
  expect(await metric(result, "Maximum error")).toBeLessThan(0.3)
  expect(await metric(result, "Gain-only RMS")).toBeGreaterThan(1)
  await expect(result.getByRole("columnheader")).toHaveText(["Filter", "Frequency", "Gain", "Q"])
  await expect(result.getByRole("cell", { name: "Bell", exact: true })).toBeVisible()
  await expect(
    page.getByRole("img", { name: "Residual (measured − fitted)", exact: true })
  ).toBeVisible()
  await expect(page.getByText(/Fitted EQ.*L → L/)).toBeVisible()
  const evidence = test.info().outputPath("synthetic-bell-fit-metrics.txt")
  await writeFile(
    evidence,
    `TEST ONLY synthetic 384-bin RBJ Bell, +6 dB at 1 kHz Q=1.2, overall +1.5 dB, 48 kHz.\n${await result.innerText()}`
  )
  await test.info().attach("synthetic-bell-fit-metrics", {
    path: evidence,
    contentType: "text/plain"
  })
  for (const theme of ["dark", "light"]) {
    await page.locator("html").evaluate((element, theme) => {
      element.dataset.theme = theme
    }, theme)
    await page.screenshot({
      path: test.info().outputPath(`eq-fit-${theme}.png`),
      fullPage: true,
      animations: "disabled"
    })
  }
  // Desktop keeps its rack width. Constrain the new panel independently to prove
  // its controls/results remain usable at a 320px content width.
  await page.locator(".linear-panel").evaluate((element) => {
    ;(element as HTMLElement).style.width = "320px"
    ;(element as HTMLElement).style.maxWidth = "320px"
  })
  await result.scrollIntoViewIfNeeded()
  expect(
    await result.evaluate((element) => element.scrollWidth - element.clientWidth)
  ).toBeLessThanOrEqual(1)
  await page.screenshot({
    path: test.info().outputPath("eq-fit-narrow.png"),
    fullPage: true,
    animations: "disabled"
  })
  const caption = result.getByText("Overall Gain", { exact: true })
  const normalTextSize = await caption.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize)
  )
  // Match the design-system reflow override. Pixel-based type tokens need an
  // explicit text-only scale too; capture before applying so inherited text
  // doubles once, while control and panel widths stay fixed.
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" })
  const panel = page.getByRole("region", { name: "Parametric EQ fit", exact: true })
  await panel.evaluate((element) => {
    const sizes = [element, ...element.querySelectorAll("*")]
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .map((node) => ({ node, size: Number.parseFloat(getComputedStyle(node).fontSize) }))
    for (const { node, size } of sizes) node.style.fontSize = `${size * 2}px`
  })
  expect(
    await caption.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  ).toBeCloseTo(normalTextSize * 2, 1)
  expect(
    await panel.evaluate((element) => element.scrollWidth - element.clientWidth)
  ).toBeLessThanOrEqual(1)
  expect(
    await result.evaluate((element) => element.scrollWidth - element.clientWidth)
  ).toBeLessThanOrEqual(1)
  const parameterTable = result.getByRole("table", { name: "Fitted EQ parameters", exact: true })
  expect(
    await parameterTable.evaluate((element) => element.scrollWidth > element.clientWidth)
  ).toBe(true)
  await parameterTable.focus()
  await parameterTable.press("ArrowRight")
  await expect
    .poll(() => parameterTable.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0)
  await page.screenshot({
    path: test.info().outputPath("eq-fit-narrow-200-text.png"),
    fullPage: true,
    animations: "disabled"
  })
  await quota.focus()
  await quota.press("ArrowDown")
  await expect(quota).toHaveValue("2")
  await expect(result).toHaveCount(0)
  await fit(page)
  expect(errors).toEqual([])
})

test("comparison requires an explicit chain and maps paths by channel rather than array position", async ({
  page,
  rendererServer
}) => {
  const comparison = syntheticReport(7, false)
  comparison.responses.reverse()
  await openAnalysis(
    page,
    rendererServer,
    analysisSnapshot({
      report: syntheticReport(),
      comparisonEnabled: true,
      comparisonReport: comparison,
      differenceReport: syntheticReport(0, false)
    })
  )
  await page
    .getByRole("combobox", { name: "Input → output", exact: true })
    .selectOption({ label: "L → L" })
  await expect(page.getByRole("button", { name: "Fit EQ", exact: true })).toBeDisabled()
  const chain = page.getByRole("combobox", { name: "EQ fit chain", exact: true })
  await chain.selectOption({ label: "Chain 2" })
  let result = await fit(page)
  expect(await metric(result, "Overall Gain")).toBeCloseTo(7, 2)
  expect(await metric(result, "RMS error")).toBeLessThan(0.01)
  await expect(page.getByText("Chain 2 · L → L", { exact: true })).toBeVisible()
  await page
    .getByRole("combobox", { name: "Input → output", exact: true })
    .selectOption({ label: "R → R" })
  await expect(result).toHaveCount(0)
  result = await fit(page)
  expect(await metric(result, "Overall Gain")).toBeCloseTo(-3, 2)
  await chain.selectOption({ label: "Chain 1" })
  await expect(result).toHaveCount(0)
  await page.getByRole("button", { name: "1 − 2", exact: true }).click()
  await expect(page.getByRole("button", { name: /^(Fit EQ|Fit again)$/ })).toBeDisabled()
})

test("cancellation and changed measurement identities cannot publish a stale worker result", async ({
  page,
  rendererServer
}) => {
  await openAnalysis(page, rendererServer)
  const path = page.getByRole("combobox", { name: "Input → output", exact: true })
  await path.selectOption({ label: "L → L" })
  const result = page.getByRole("region", { name: "EQ fit result", exact: true })
  const changes: Array<() => Promise<void>> = [
    async () => {
      await page.getByRole("button", { name: "Cancel fit", exact: true }).click()
    },
    async () => {
      await path.selectOption({ label: "R → R" })
    },
    async () => {
      await page.getByRole("spinbutton", { name: "EQ quota" }).press("ArrowUp")
    },
    async () => {
      await replaceSnapshot(
        page,
        analysisSnapshot({
          report: syntheticReport(4, false),
          reportId: "test-new-report",
          reportRevision: 4,
          revision: 4
        })
      )
    }
  ]
  for (const change of changes) {
    rendererServer.holdWorkers()
    const requests = rendererServer.workerRequests()
    await page.getByRole("button", { name: /^(Fit EQ|Fit again)$/ }).click()
    await expect.poll(() => rendererServer.workerRequests()).toBe(requests + 1)
    await expect(page.getByRole("button", { name: "Cancel fit", exact: true })).toBeVisible()
    await change()
    await expect(page.getByRole("button", { name: "Cancel fit", exact: true })).toHaveCount(0)
    rendererServer.releaseWorkers()
    await expect(result).toHaveCount(0)
  }
  await path.selectOption({ label: "L → L" })
  expect(await metric(await fit(page), "Overall Gain")).toBeCloseTo(4, 2)
  const repeat = page.getByRole("checkbox", { name: "Repeat analysis", exact: true })
  await repeat.focus()
  await repeat.press("Space")
  await expect(repeat).toBeChecked()
  await replaceSnapshot(
    page,
    analysisSnapshot({
      report: syntheticReport(2, false),
      reportId: "test-repeat-report",
      reportRevision: 4,
      revision: 4,
      repeating: true
    })
  )
  await expect(result).toHaveCount(0)
  expect(await metric(await fit(page), "Overall Gain")).toBeCloseTo(2, 2)
})
