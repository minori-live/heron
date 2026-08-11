import { flushPromises, mount } from "@vue/test-utils"
import { createPinia } from "pinia"
import { createMemoryHistory, createRouter } from "vue-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Config, Driver } from "driver.js"
import TutorialHost from "./TutorialHost.vue"
import { useTutorialController } from "../../composables/useTutorialController"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useProjectStore } from "../../stores/project"
import { settingsSnapshot, testSettings } from "../../test/ipc"

const driverMocks = vi.hoisted(() => ({
  configs: [] as Config[],
  instances: [] as Driver[]
}))

vi.mock("driver.js", () => ({
  driver: vi.fn((config: Config) => {
    let destroyed = false
    const instance = {
      isActive: () => !destroyed,
      refresh: vi.fn(),
      drive: vi.fn(),
      setConfig: vi.fn(),
      setSteps: vi.fn(),
      getConfig: () => config,
      getState: vi.fn(),
      getActiveIndex: vi.fn(),
      isFirstStep: vi.fn(),
      isLastStep: vi.fn(),
      getActiveStep: vi.fn(),
      getActiveElement: vi.fn(),
      getPreviousElement: vi.fn(),
      getPreviousStep: vi.fn(),
      getNextStep: vi.fn(),
      moveNext: vi.fn(),
      movePrevious: vi.fn(),
      moveTo: vi.fn(),
      hasNextStep: vi.fn(),
      hasPreviousStep: vi.fn(),
      highlight: vi.fn(),
      destroy: vi.fn(() => {
        if (destroyed) return
        destroyed = true
        config.onDestroyed?.(undefined, config.steps?.[0] ?? {}, {
          config,
          state: {},
          driver: instance,
          index: 0
        })
      })
    } satisfies Driver
    driverMocks.configs.push(config)
    driverMocks.instances.push(instance)
    return instance
  })
}))

const openSession = {
  status: "open",
  session: {
    id: "project",
    path: "/project.heron",
    configuration: {
      name: "Project",
      sampleRate: 48_000,
      timeSignatureNumerator: 4,
      timeSignatureDenominator: 4,
      waveformDisplayMode: "separate"
    },
    dirty: false,
    recoveredWorkingCopy: false
  },
  error: null
} as const

function createTargets(): void {
  for (const target of [
    "studio-arrangement",
    "studio-transport",
    "studio-musical-display",
    "studio-inspector",
    "studio-lower-editors",
    "studio-right-panels"
  ]) {
    const element = document.createElement("div")
    element.dataset.tutorial = target
    element.getClientRects = () => [{ width: 100, height: 40 }] as unknown as DOMRectList
    document.body.append(element)
  }
}

async function mountHost(options: { autoStart?: boolean; completed?: boolean } = {}) {
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/studio", name: "studio", component: { template: "<div />" } }]
  })
  await router.push({ name: "studio" })
  await router.isReady()

  const settingsStore = useApplicationSettingsStore(pinia)
  settingsStore.applySnapshot(
    settingsSnapshot(
      testSettings({
        tutorials: {
          autoStart: options.autoStart ?? true,
          completedVersions: options.completed ? { "studio-basics": 1 } : {}
        }
      })
    )
  )
  useProjectStore(pinia).applyLifecycleState(openSession)

  const wrapper = mount(TutorialHost, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return { pinia, router, settingsStore, wrapper }
}

describe("TutorialHost", () => {
  beforeEach(() => {
    driverMocks.configs.length = 0
    driverMocks.instances.length = 0
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal("matchMedia", () => ({ matches: false }))
    createTargets()
  })

  it("automatically starts the incomplete Studio tour and records completion", async () => {
    const { settingsStore, wrapper } = await mountHost()
    const markCompleted = vi.spyOn(settingsStore, "markTutorialCompleted").mockResolvedValue(true)

    expect(driverMocks.configs).toHaveLength(1)
    expect(driverMocks.configs[0]).toMatchObject({
      disableActiveInteraction: true,
      showProgress: true,
      progressText: "{{current}} of {{total}}",
      steps: expect.arrayContaining([
        expect.objectContaining({ element: '[data-tutorial="studio-arrangement"]' })
      ])
    })

    driverMocks.configs[0]?.onDoneClick?.(undefined, driverMocks.configs[0]?.steps?.[0] ?? {}, {
      config: driverMocks.configs[0],
      state: {},
      driver: driverMocks.instances[0]!,
      index: 0
    })
    await flushPromises()

    expect(markCompleted).toHaveBeenCalledWith("studio-basics", 1)
    expect(driverMocks.instances[0]?.destroy).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it("keeps an early dismissal session-only while manual Help replay remains available", async () => {
    const first = await mountHost()
    expect(driverMocks.configs).toHaveLength(1)

    driverMocks.instances[0]?.destroy()
    document.body.append(document.createElement("div"))
    await flushPromises()
    expect(driverMocks.configs).toHaveLength(1)

    useTutorialController().requestStudioBasics()
    await flushPromises()
    expect(driverMocks.configs).toHaveLength(2)
    first.wrapper.unmount()

    await mountHost()
    expect(driverMocks.configs).toHaveLength(3)
  })

  it("allows Help replay when automatic tutorials are disabled and already completed", async () => {
    const { wrapper } = await mountHost({ autoStart: false, completed: true })
    expect(driverMocks.configs).toHaveLength(0)

    useTutorialController().requestStudioBasics()
    await flushPromises()

    expect(driverMocks.configs).toHaveLength(1)
    wrapper.unmount()
  })
})
