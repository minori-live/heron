import { expect, test as base, type Locator, type Page } from "@playwright/test"
import { readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve, sep } from "node:path"
import type { PluginAnalysisEqFitSnapshot, PluginAnalysisReport } from "@heron/contracts"
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

function eqFitSnapshot(
  overrides: Partial<PluginAnalysisEqFitSnapshot> = {}
): PluginAnalysisEqFitSnapshot {
  const analysis = analysisSnapshot()
  return {
    ref: analysis.ref,
    revision: analysis.revision,
    selectionRevision: 1,
    selection: {
      reportId: analysis.reportId!,
      reportRevision: analysis.reportRevision!,
      input: 0,
      output: 0,
      mode: "single"
    },
    reportId: analysis.reportId,
    reportRevision: analysis.reportRevision,
    report: syntheticReport(),
    comparisonReport: null,
    locale: analysis.locale,
    theme: analysis.theme,
    maximized: false,
    ...overrides
  }
}

async function openEqFit(
  page: Page,
  server: RendererServer,
  initial = eqFitSnapshot()
): Promise<void> {
  await page.addInitScript((initial) => {
    let snapshot = initial
    Object.defineProperty(window, "setEqTestSnapshot", {
      value: (next: typeof initial) => {
        snapshot = next
      }
    })
    Object.defineProperty(window, "heronPluginAnalysisEqFit", {
      value: {
        platform: "win32",
        snapshot: async (_meta: unknown, knownReportId?: string) => ({
          ok: true,
          // Exercise the actual bridge's polling contract: selection changes can
          // reuse report bodies, while a new run always delivers new raw bins.
          value: structuredClone({
            ...snapshot,
            report: knownReportId === snapshot.reportId ? null : snapshot.report,
            comparisonReport: knownReportId === snapshot.reportId ? null : snapshot.comparisonReport
          })
        }),
        window: async (_meta: unknown, command: { type: string; maximized?: boolean }) => {
          if (command.type === "set-maximized")
            snapshot = { ...snapshot, maximized: command.maximized ?? false }
          return { ok: true, value: { maximized: snapshot.maximized } }
        }
      }
    })
  }, initial)
  await page.goto(`${server.url}/plugin-analysis-eq-fit.html`)
  await expect(page.getByRole("button", { name: "Fit EQ", exact: true })).toBeVisible()
}

async function replaceSnapshot(page: Page, snapshot: PluginAnalysisEqFitSnapshot): Promise<void> {
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
  await openEqFit(page, rendererServer)
  const quota = page.getByRole("spinbutton", { name: "EQ quota" })
  await expect(quota).toHaveValue("3")
  const fitButton = page.getByRole("button", { name: "Fit EQ", exact: true })
  await expect(fitButton).toBeEnabled()
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
  // The standalone window has no Analysis rack: test its actual viewport reflow.
  await page.setViewportSize({ width: 320, height: 900 })
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
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
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
  const initial = eqFitSnapshot()
  let snapshot = eqFitSnapshot({
    selection: { ...initial.selection!, mode: "parallel" },
    comparisonReport: comparison
  })
  await openEqFit(page, rendererServer, snapshot)
  await expect(page.getByRole("button", { name: "Fit EQ", exact: true })).toBeDisabled()
  const chain = page.getByRole("combobox", { name: "EQ fit chain", exact: true })
  await chain.selectOption({ label: "Chain 2" })
  let result = await fit(page)
  expect(await metric(result, "Overall Gain")).toBeCloseTo(7, 2)
  expect(await metric(result, "RMS error")).toBeLessThan(0.01)
  await expect(page.getByText("Chain 2 · L → L", { exact: true })).toBeVisible()
  snapshot = {
    ...snapshot,
    selectionRevision: 2,
    selection: { ...snapshot.selection!, input: 1, output: 1 }
  }
  await replaceSnapshot(page, snapshot)
  await expect(result).toHaveCount(0)
  result = await fit(page)
  expect(await metric(result, "Overall Gain")).toBeCloseTo(-3, 2)
  await chain.selectOption({ label: "Chain 1" })
  await expect(result).toHaveCount(0)
  // Returning the parent to L+R removes selection and any cached report body.
  await replaceSnapshot(page, {
    ...snapshot,
    selectionRevision: 3,
    selection: null,
    reportId: null,
    reportRevision: null,
    report: null,
    comparisonReport: null
  })
  await expect(page.getByRole("button", { name: /^(Fit EQ|Fit again)$/ })).toHaveCount(0)
  await expect(result).toHaveCount(0)
})

test("cancellation and changed measurement identities cannot publish a stale worker result", async ({
  page,
  rendererServer
}) => {
  let snapshot = eqFitSnapshot()
  await openEqFit(page, rendererServer, snapshot)
  const result = page.getByRole("region", { name: "EQ fit result", exact: true })
  const changes: Array<() => Promise<void>> = [
    async () => {
      await page.getByRole("button", { name: "Cancel fit", exact: true }).click()
    },
    async () => {
      snapshot = {
        ...snapshot,
        selectionRevision: 2,
        selection: { ...snapshot.selection!, input: 1, output: 1 }
      }
      await replaceSnapshot(page, snapshot)
    },
    async () => {
      await page.getByRole("spinbutton", { name: "EQ quota" }).press("ArrowUp")
    },
    async () => {
      snapshot = {
        ...snapshot,
        report: syntheticReport(4, false),
        reportId: "test-new-report",
        reportRevision: 4,
        revision: 4,
        selectionRevision: 3,
        selection: {
          ...snapshot.selection!,
          reportId: "test-new-report",
          reportRevision: 4,
          input: 0,
          output: 0
        }
      }
      await replaceSnapshot(page, snapshot)
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
  expect(await metric(await fit(page), "Overall Gain")).toBeCloseTo(4, 2)
  // Repeating analysis can publish a new report without changing configuration.
  snapshot = {
    ...snapshot,
    report: syntheticReport(2, false),
    reportId: "test-repeat-report",
    selectionRevision: 4,
    selection: { ...snapshot.selection!, reportId: "test-repeat-report" }
  }
  await replaceSnapshot(page, snapshot)
  await expect(result).toHaveCount(0)
  expect(await metric(await fit(page), "Overall Gain")).toBeCloseTo(2, 2)
})
