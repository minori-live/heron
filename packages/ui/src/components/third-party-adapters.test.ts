import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import type { Config } from "driver.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import UiGuidedTour from "./UiGuidedTour.vue"
import UiNodeGraph from "./UiNodeGraph.vue"

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  on: vi.fn(),
  dispose: vi.fn(),
  resize: vi.fn(),
  dispatchAction: vi.fn()
}))
const chartInit = vi.hoisted(() => vi.fn(() => chart))
vi.mock("echarts/core", () => ({ init: chartInit, use: vi.fn() }))
vi.mock("echarts/charts", () => ({ GraphChart: {} }))
vi.mock("echarts/components", () => ({ TooltipComponent: {} }))
vi.mock("echarts/renderers", () => ({ CanvasRenderer: {} }))
const tour = vi.hoisted(() => ({ drive: vi.fn(), destroy: vi.fn() }))
const createDriver = vi.hoisted(() => vi.fn<(config: Config) => typeof tour>())
vi.mock("driver.js", () => ({ driver: createDriver }))

enableAutoUnmount(afterEach)
let onResize: () => void
const disconnect = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        onResize = callback
      }
      observe() {}
      disconnect = disconnect
    }
  )
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
  createDriver.mockImplementation((config) => {
    tour.destroy.mockImplementation(() =>
      config.onDestroyed?.(undefined, config.steps?.[0] ?? {}, {
        config,
        state: {},
        driver: tour,
        index: 0
      } as unknown as Parameters<NonNullable<Config["onDestroyed"]>>[2])
    )
    return tour
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ""
})

describe("third-party UI adapters", () => {
  it("maps graph view-models and emits only selected node IDs, resets and disposes resources", async () => {
    const graph = mount(UiNodeGraph, {
      props: {
        label: "Audio routing",
        nodes: [
          { id: "input", label: "Input", x: 0, y: 0, detail: "Stereo input" },
          { id: "output", label: "Output", x: 100, y: 0, tone: "warning", disabled: true }
        ],
        edges: [
          { id: "route", from: "input", to: "output", tone: "warning" },
          { id: "return", from: "output", to: "input" }
        ]
      }
    })
    await vi.waitFor(() => expect(chart.setOption).toHaveBeenCalledOnce())
    expect(graph.attributes("aria-label")).toBe("Audio routing")
    const options = chart.setOption.mock.calls[0]![0]
    expect(options.series[0].data).toEqual([
      expect.objectContaining({
        id: "input",
        name: "Input",
        detail: "Stereo input",
        itemStyle: { color: "var(--ui-color-surface-active)", opacity: 1 }
      }),
      expect.objectContaining({
        id: "output",
        itemStyle: { color: "var(--ui-color-warning)", opacity: 0.45 }
      })
    ])
    expect(options.series[0].links[0]).toMatchObject({
      source: "input",
      target: "output",
      lineStyle: { type: "dashed" }
    })
    expect(options.series[0].links[1].lineStyle.type).toBe("solid")
    expect(options.tooltip.formatter({ data: { detail: "Stereo input" } })).toBe("Stereo input")
    expect(options.tooltip.formatter({})).toBe("")
    const click = chart.on.mock.calls[0]![1]
    click({ dataType: "node", data: { id: "input" } })
    click({ dataType: "edge", data: { id: "route" } })
    click({ dataType: "node", data: null })
    expect(graph.emitted("selectNode")).toEqual([["input"]])
    onResize()
    expect(chart.resize).toHaveBeenCalledOnce()
    await graph.setProps({ resetToken: 1 })
    expect(chart.dispatchAction).toHaveBeenCalledWith({ type: "restore" })
    await graph.setProps({
      nodes: [{ id: "new", label: "New input", x: 10, y: 20 }],
      interactive: false
    })
    await vi.waitFor(() => expect(chartInit).toHaveBeenCalledTimes(2))
    expect(chart.setOption.mock.calls.at(-1)![0].series[0].roam).toBe(false)
    expect(chart.dispose).toHaveBeenCalledOnce()
    graph.unmount()
    expect(chart.dispose).toHaveBeenCalledTimes(2)
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it("does not initialize a chart after its host has unmounted", async () => {
    const graph = mount(UiNodeGraph, { props: { label: "Routing", nodes: [], edges: [] } })
    graph.unmount()
    await flushPromises()
    expect(chartInit).not.toHaveBeenCalled()
  })

  const tourProps = {
    active: false,
    steps: [{ id: "welcome", title: "Welcome", description: "Start here" }],
    progressLabel: "{{current}} / {{total}}",
    nextLabel: "Next",
    previousLabel: "Previous",
    doneLabel: "Done"
  }

  it("starts tours only when requested, maps localized steps, and distinguishes completion from cancellation", async () => {
    const guide = mount(UiGuidedTour, { props: tourProps })
    await flushPromises()
    expect(createDriver).not.toHaveBeenCalled()
    await guide.setProps({ active: true })
    await flushPromises()
    expect(tour.drive).toHaveBeenCalledOnce()
    const config = createDriver.mock.calls[0]![0]
    expect(config).toMatchObject({
      nextBtnText: "Next",
      prevBtnText: "Previous",
      doneBtnText: "Done",
      progressText: "{{current}} / {{total}}",
      steps: [{ popover: { title: "Welcome", description: "Start here" } }]
    })
    config.onDoneClick?.(undefined, config.steps?.[0] ?? {}, {
      config,
      state: {},
      driver: tour,
      index: 0
    } as unknown as Parameters<NonNullable<Config["onDoneClick"]>>[2])
    expect(guide.emitted("complete")).toEqual([[]])
    expect(guide.emitted("cancel")).toBeUndefined()
    await guide.setProps({ active: false })
    await guide.setProps({ active: true })
    await flushPromises()
    await guide.setProps({ active: false })
    expect(guide.emitted("cancel")).toEqual([[]])
  })

  it("filters missing or hidden targets and reports an unavailable tour", async () => {
    const guide = mount(UiGuidedTour, {
      props: {
        ...tourProps,
        active: true,
        steps: [
          { id: "missing", target: "#missing", title: "Missing", description: "Hidden target" }
        ]
      }
    })
    await flushPromises()
    expect(guide.emitted("unavailable")).toEqual([[]])
    expect(createDriver).not.toHaveBeenCalled()
  })

  it("rebuilds changed steps, respects reduced motion, and cleans up the active tour", async () => {
    const target = document.createElement("div")
    target.id = "visible-target"
    document.body.append(target)
    vi.spyOn(target, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 20, 20)
    ] as unknown as DOMRectList)
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    const guide = mount(UiGuidedTour, {
      props: {
        ...tourProps,
        active: true,
        steps: [
          {
            id: "track",
            target: "#visible-target",
            title: "Track",
            description: "Select a track",
            placement: "bottom",
            align: "start"
          }
        ]
      }
    })
    await flushPromises()
    expect(createDriver.mock.calls[0]![0]).toMatchObject({
      animate: false,
      steps: [{ element: "#visible-target", popover: { side: "bottom", align: "start" } }]
    })
    await guide.setProps({ steps: [{ id: "mixer", title: "Next section", description: "Mixer" }] })
    await flushPromises()
    expect(tour.drive).toHaveBeenCalledTimes(2)
    expect(tour.destroy).toHaveBeenCalledOnce()
    guide.unmount()
    expect(tour.destroy).toHaveBeenCalledTimes(2)
  })
})
