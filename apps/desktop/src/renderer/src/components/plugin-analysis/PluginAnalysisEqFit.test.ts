import { shallowMount, type VueWrapper } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UiButton, UiNumberInput, UiSelect } from "@heron/ui"
import type { EqFitResult } from "../../lib/eq-fit"
import { analysisReport } from "../../test/plugin-analysis"
import type { EqFitInput, EqFitSuccess } from "./eqFitWorkerTypes"
import PluginAnalysisEqFit from "./PluginAnalysisEqFit.vue"
import PluginAnalysisEqFitResult from "./PluginAnalysisEqFitResult.vue"
import PluginAnalysisPlot from "./PluginAnalysisPlot.vue"

class FitWorker {
  static instances: FitWorker[] = []
  onmessage: ((event: MessageEvent<EqFitResult>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  input: EqFitInput | null = null
  terminated = false
  constructor() {
    FitWorker.instances.push(this)
  }
  postMessage(input: EqFitInput) {
    this.input = input
  }
  terminate() {
    this.terminated = true
  }
  reply(result: EqFitResult) {
    this.onmessage?.({ data: result } as MessageEvent<EqFitResult>)
  }
}

function fitted(): EqFitSuccess {
  return {
    ok: true,
    sections: [{ type: "Bell", frequencyHz: 1000, gainDb: 6, q: 1 }],
    overallGainDb: -2,
    fittedDb: [-11, 5],
    residualDb: [-1, 1],
    rmsErrorDb: 1,
    maxErrorDb: 1,
    baselineRmsErrorDb: 9,
    baselineMaxErrorDb: 9,
    elapsedMs: 120,
    iterations: 4,
    warnings: ["poor-fit"]
  }
}
const wrappers: VueWrapper[] = []
function panel(props: Partial<InstanceType<typeof PluginAnalysisEqFit>["$props"]> = {}) {
  const wrapper = shallowMount(PluginAnalysisEqFit, {
    props: {
      report: analysisReport(),
      input: 0,
      output: 0,
      reportId: "report-1",
      reportRevision: 1,
      revision: 1,
      ...props
    }
  })
  wrappers.push(wrapper)
  return wrapper
}
function runButton(wrapper: VueWrapper) {
  return wrapper.findAllComponents(UiButton)[0]!
}
async function start(wrapper: VueWrapper) {
  runButton(wrapper).vm.$emit("click")
  await nextTick()
  return FitWorker.instances.at(-1)!
}
beforeEach(() => {
  FitWorker.instances = []
  vi.stubGlobal("Worker", FitWorker)
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.unstubAllGlobals()
})

describe("EQ fit orchestration", () => {
  it("requires an explicit comparison chain, defaults quota to three, and maps raw samples by channel pair", async () => {
    const comparison = analysisReport()
    comparison.settings.sample_rate = 96000
    comparison.responses.reverse()
    comparison.responses.find(
      (response) => response.input === 0 && response.output === 0
    )!.magnitude_db = [2, 4]
    const wrapper = panel({ comparison, mode: "parallel" })
    expect(wrapper.getComponent(UiNumberInput).props()).toMatchObject({
      modelValue: 3,
      min: 1,
      max: 24
    })
    expect(runButton(wrapper).props("disabled")).toBe(true)
    expect(wrapper.get('[role="status"]').text()).toContain("Choose the chain")
    wrapper.getComponent(UiSelect).vm.$emit("update:modelValue", "comparison")
    await nextTick()
    expect(runButton(wrapper).props("disabled")).toBe(false)
    const worker = await start(wrapper)
    expect(worker.input).toEqual({
      sampleRate: 96000,
      frequencyHz: [100, 1000],
      magnitudeDb: [2, 4],
      quota: 3
    })
    expect(runButton(wrapper).props("disabled")).toBe(true)
    worker.reply(fitted())
    await nextTick()
    expect(worker.terminated).toBe(true)
    expect(wrapper.getComponent(PluginAnalysisEqFitResult).props("result").rmsErrorDb).toBe(1)
    expect(wrapper.getComponent(PluginAnalysisPlot).props("series")[1]).toMatchObject({
      label: "Fitted EQ · Chain 2 · L → L",
      x: [100, 1000],
      y: [-11, 5]
    })
    expect(wrapper.text()).toContain("remaining error is significant")
    await wrapper.setProps({ mode: "primary", comparison: undefined })
    expect(wrapper.findComponent(PluginAnalysisEqFitResult).exists()).toBe(false)
    expect((await start(wrapper)).input?.magnitudeDb).toEqual([-12, 6])
  })

  it("retains a result across cloned snapshots but clears it on report or source revision changes", async () => {
    const wrapper = panel()
    ;(await start(wrapper)).reply(fitted())
    await nextTick()
    await wrapper.setProps({ report: analysisReport() })
    expect(wrapper.findComponent(PluginAnalysisEqFitResult).exists()).toBe(true)
    await wrapper.setProps({ reportId: "report-2" })
    expect(wrapper.findComponent(PluginAnalysisEqFitResult).exists()).toBe(false)
    const current = await start(wrapper)
    await wrapper.setProps({ revision: 2, stale: true })
    current.reply(fitted())
    await nextTick()
    expect(current.terminated).toBe(true)
    expect(wrapper.findComponent(PluginAnalysisEqFitResult).exists()).toBe(false)
    expect(runButton(wrapper).props("disabled")).toBe(true)
    expect(wrapper.getComponent(PluginAnalysisPlot).props("series")).toHaveLength(1)
  })

  it("terminates active searches on path, quota, chain and report revision changes", async () => {
    const wrapper = panel({ comparison: analysisReport(), mode: "parallel" })
    wrapper.getComponent(UiSelect).vm.$emit("update:modelValue", "primary")
    await nextTick()
    let worker = await start(wrapper)
    await wrapper.setProps({ input: 1, output: 1 })
    expect(worker.terminated).toBe(true)
    worker = await start(wrapper)
    wrapper.getComponent(UiNumberInput).vm.$emit("update:modelValue", 2)
    await nextTick()
    expect(worker.terminated).toBe(true)
    worker = await start(wrapper)
    expect(worker.input?.quota).toBe(2)
    wrapper.getComponent(UiSelect).vm.$emit("update:modelValue", "comparison")
    await nextTick()
    expect(worker.terminated).toBe(true)
    worker = await start(wrapper)
    await wrapper.setProps({ reportRevision: 2 })
    expect(worker.terminated).toBe(true)
    worker.reply(fitted())
    await nextTick()
    expect(wrapper.findComponent(PluginAnalysisEqFitResult).exists()).toBe(false)
  })

  it("cancels immediately and ignores queued replies and errors from a previous run during retry", async () => {
    const wrapper = panel()
    const old = await start(wrapper)
    wrapper.findAllComponents(UiButton)[1]!.vm.$emit("click")
    await nextTick()
    expect(old.terminated).toBe(true)
    expect(wrapper.get('[role="status"]').text()).toContain("cancelled")
    const current = await start(wrapper)
    old.reply(fitted())
    old.onerror?.()
    await nextTick()
    expect(wrapper.attributes("aria-busy")).toBe("true")
    expect(wrapper.findComponent(PluginAnalysisEqFitResult).exists()).toBe(false)
    current.reply({ ok: false, code: "no-signal" })
    await nextTick()
    expect(wrapper.get('[role="alert"]').text()).toContain("No reliable signal")
    expect(runButton(wrapper).props("disabled")).toBe(false)
    ;(await start(wrapper)).reply(fitted())
    await nextTick()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findComponent(PluginAnalysisEqFitResult).exists()).toBe(true)
  })

  it("normalizes worker launch and transport failures to a retryable state and terminates on unmount", async () => {
    const wrapper = panel()
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("unavailable")
        }
      }
    )
    await start(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain("Try fitting again")
    vi.stubGlobal("Worker", FitWorker)
    const broken = await start(wrapper)
    broken.onmessageerror?.()
    await nextTick()
    expect(broken.terminated).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toContain("Try fitting again")
    const active = await start(wrapper)
    wrapper.unmount()
    expect(active.terminated).toBe(true)
  })

  it("does not fit a difference response or invalid quotas and names M/S paths", async () => {
    const report = analysisReport()
    report.settings.mid_side = true
    const wrapper = panel({ mode: "difference", report })
    expect(runButton(wrapper).props("disabled")).toBe(true)
    expect(wrapper.get('[role="status"]').text()).toContain("Difference curves")
    await wrapper.setProps({ mode: "single" })
    wrapper.getComponent(UiNumberInput).vm.$emit("update:modelValue", null)
    await nextTick()
    expect(runButton(wrapper).props("disabled")).toBe(true)
    wrapper.getComponent(UiNumberInput).vm.$emit("update:modelValue", 2.5)
    await nextTick()
    expect(runButton(wrapper).props("disabled")).toBe(true)
    wrapper.getComponent(UiNumberInput).vm.$emit("update:modelValue", 3)
    await nextTick()
    ;(await start(wrapper)).reply(fitted())
    await nextTick()
    expect(wrapper.getComponent(PluginAnalysisPlot).props("series")[1]).toMatchObject({
      label: "Fitted EQ · M → M"
    })
  })
})
