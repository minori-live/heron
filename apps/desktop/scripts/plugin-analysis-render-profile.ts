import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { cpus, platform, release } from "node:os"
import { join, resolve } from "node:path"
import { chromium } from "@playwright/test"
import vue from "@vitejs/plugin-vue"
import { build, preview } from "vite"

// Run from the locked toolchain: node apps/desktop/scripts/plugin-analysis-render-profile.ts
// This builds the real plot in production mode. Native measurements/IPC are deliberately
// excluded; deterministic inputs match native response and spectrogram dimensions.
const repository = resolve(import.meta.dirname, "../../..")
const cache = join(repository, "node_modules/.cache")
await mkdir(cache, { recursive: true })
const savedBundle = process.env.HERON_RENDER_PROFILE_BUNDLE
const directory = savedBundle
  ? resolve(savedBundle)
  : await mkdtemp(join(cache, "analysis-render-profile-"))
const ui = resolve(repository, "packages/ui")
const output = process.argv[2]
const samples = Number(process.env.HERON_RENDER_PROFILE_SAMPLES ?? 12)
if (!Number.isInteger(samples) || samples < 1) throw new Error("Invalid sample count")
const entry = `
import { createApp, h, shallowRef, nextTick } from "vue"
import { registerPostInit } from "echarts/core"
import Plot from ${JSON.stringify(join(ui, "src/components/UiAnalysisPlot.vue").replaceAll("\\", "/"))}
import ${JSON.stringify(join(ui, "src/styles/index.css").replaceAll("\\", "/"))}

let pending = 0
let measurements = []
registerPostInit(chart => {
  const original = chart.setOption
  chart.setOption = function (...args) {
    const record = { synchronousMs: 0, finishedMs: null }
    const start = performance.now()
    pending++
    const finished = () => {
      chart.off("finished", finished)
      record.finishedMs = performance.now() - start
      pending--
    }
    chart.on("finished", finished)
    const result = original.apply(chart, args)
    record.synchronousMs = performance.now() - start
    measurements.push(record)
    return result
  }
})
const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
async function settle() {
  await nextTick()
  for (let i = 0; i < 1200; i++) {
    await frame()
    if (!pending && document.querySelector("canvas")) {
      await frame()
      if (!pending) return
    }
  }
  throw new Error("Chart did not finish")
}
const lineX = Array.from({length:384}, (_, i) => 20 * 1000 ** (i / 383))
const lineSeries = count => Array.from({length:count}, (_, channel) => ({
  label: "Channel " + channel,
  x: lineX,
  y: lineX.map(hz => -10 * Math.log10(1 + (hz / (4000 + channel * 500)) ** 2))
}))
const heatmap = {
  columns:192,
  rows:512,
  values: Array.from({length:192*512}, (_, i) => {
    const column = Math.floor(i / 512)
    const row = i % 512
    const fundamental = 4 + column * 2
    return Math.abs(row - fundamental) < 2 ? 0 : Math.abs(row - fundamental * 2) < 2 ? -24 : -120
  })
}
window.runProfile = async function (kind, samples) {
  const isHeatmap = kind === "spectrogram"
  const input = shallowRef({
    label: kind, xLabel: isHeatmap ? "s" : "Hz", yLabel: isHeatmap ? "Hz" : "dB",
    xUnit: isHeatmap ? "s" : "Hz", yUnit: isHeatmap ? "Hz" : "dB",
    xMinimumStep: isHeatmap ? 0.001 : 1, yMinimumStep: 1,
    logarithmic: !isHeatmap,
    xDomain: isHeatmap ? [0,1] : [20,20000],
    yDomain: isHeatmap ? [0,24000] : [-24,6],
    series: isHeatmap ? [] : lineSeries(kind === "comparison" ? 4 : 2),
    heatmap: isHeatmap ? heatmap : undefined
  })
  const start = performance.now()
  const app = createApp({ render: () => h(Plot, input.value) })
  app.mount("#app")
  await settle()
  const mount = { totalMs:performance.now()-start, updates:measurements }
  const plot = document.querySelector('[role="img"]')
  const rect = plot.getBoundingClientRect()
  const warm = []
  for (let i = 0; i < samples; i++) {
    measurements = []
    const began = performance.now()
    plot.dispatchEvent(new WheelEvent("wheel", {
      bubbles:true, cancelable:true, clientX:rect.left + rect.width/2,
      clientY:rect.top + rect.height/2, deltaY:i%2 ? 1 : -1, ctrlKey:true
    }))
    await settle()
    warm.push({totalMs:performance.now()-began, updates:[...measurements]})
  }
  const canvas = Boolean(plot.querySelector("canvas"))
  let hover = null
  if (isHeatmap) {
    plot.dispatchEvent(new MouseEvent("dblclick", {bubbles:true}))
    await settle()
    plot.querySelector("canvas").dispatchEvent(new MouseEvent("mousemove", {
      bubbles:true,
      clientX:rect.left + 96 + (rect.width-196)*80/191,
      clientY:rect.top + 18 + (rect.height-64)*(1-328.5/512)
    }))
    await frame()
    hover = plot.textContent
    if (!hover.includes("s: 0.41884817") || !hover.includes("Hz: 15375–15421.875") || !hover.includes("-24 dBFS")) {
      throw new Error("Spectrogram lost original hover measurement: " + hover)
    }
  }
  return {kind, dimensions:isHeatmap ? [192,512] : [kind === "comparison" ? 4 : 2,384], mount, warm, canvas, hover}
}
`
if (!savedBundle) {
  await writeFile(join(directory, "entry.js"), entry)
  await writeFile(
    join(directory, "index.html"),
    '<html data-theme="dark"><body><div id="app" style="width:1000px;height:500px"></div><script type="module" src="./entry.js"></script></body></html>'
  )
}
const config = {
  configFile: false as const,
  root: directory,
  plugins: [vue()],
  resolve: {
    alias: {
      vue: resolve(repository, "apps/desktop/node_modules/vue/dist/vue.runtime.esm-bundler.js"),
      echarts: resolve(ui, "node_modules/echarts")
    }
  },
  build: { outDir: join(directory, "dist"), minify: true },
  logLevel: "warn" as const
}
if (!savedBundle) {
  await build(config)
  await writeFile(
    join(directory, "profile-build.json"),
    JSON.stringify({
      sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
      dirty: Boolean(
        execFileSync("git", ["status", "--porcelain"], { cwd: repository, encoding: "utf8" }).trim()
      ),
      createdAt: new Date().toISOString()
    })
  )
}
const bundle = JSON.parse(await readFile(join(directory, "profile-build.json"), "utf8")) as unknown
const server = await preview({ ...config, preview: { host: "127.0.0.1", port: 0 } })
const browser = await chromium.launch({ headless: true })
try {
  const results = []
  const address = server.httpServer.address()
  if (!address || typeof address === "string") throw new Error("Preview did not bind a TCP port")
  for (const kind of ["stereo", "comparison", "spectrogram"]) {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 800 },
      deviceScaleFactor: 1
    })
    page.on("pageerror", (error) => console.error(error))
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.waitForFunction(() => "runProfile" in window)
    const result = await page.evaluate(
      async ({ kind, samples }) => {
        const run = Reflect.get(window, "runProfile") as (
          kind: string,
          samples: number
        ) => Promise<unknown>
        return run(kind, samples)
      },
      { kind, samples }
    )
    results.push(result)
    if (process.env.HERON_RENDER_PROFILE_SCREENSHOTS) {
      const screenshots = resolve(process.env.HERON_RENDER_PROFILE_SCREENSHOTS)
      await mkdir(screenshots, { recursive: true })
      await page.screenshot({ path: join(screenshots, `${kind}.png`) })
    }
    await page.close()
  }
  const report = {
    sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
    dirty: Boolean(
      execFileSync("git", ["status", "--porcelain"], { cwd: repository, encoding: "utf8" }).trim()
    ),
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    browser: browser.version(),
    bundle,
    bundleDirectory: directory,
    build: "Vite production, minified; Chromium headless canvas; 1000x500 CSS px, DPR1",
    note: "First component mount in each fresh page; warm alternating Ctrl-wheel zoom. totalMs includes two animation frames after finished; synchronousMs isolates ECharts setOption. Deterministic native-size synthetic plots, not end-to-end analysis.",
    samples,
    results
  }
  const json = JSON.stringify(report, null, 2)
  if (output) await writeFile(resolve(output), json + "\n")
  console.log(json)
} finally {
  await browser.close()
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve()))
  )
}
