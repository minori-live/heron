import { flushPromises, mount } from "@vue/test-utils"
import { createPinia } from "pinia"
import { defineComponent } from "vue"
import { createMemoryHistory, createRouter } from "vue-router"
import { describe, expect, it, vi } from "vitest"
import TutorialHost from "./TutorialHost.vue"
import { useTutorialController } from "../../composables/useTutorialController"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useProjectStore } from "../../stores/project"
import { settingsSnapshot, testSettings } from "../../test/ipc"

const GuidedTourStub = defineComponent({
  name: "UiGuidedTour",
  props: { active: Boolean, steps: { type: Array, default: () => [] } },
  emits: ["complete", "cancel", "unavailable"],
  template: "<div data-test='guided-tour' />"
})
const openSession = {
  status: "open",
  session: {
    id: "project",
    path: "/project.heron",
    dirty: false,
    recoveredWorkingCopy: false,
    configuration: {
      name: "Project",
      sampleRate: 48_000,
      timeSignatureNumerator: 4,
      timeSignatureDenominator: 4,
      waveformDisplayMode: "separate"
    }
  },
  error: null
} as const

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
  const wrapper = mount(TutorialHost, {
    global: { plugins: [pinia, router], stubs: { UiGuidedTour: GuidedTourStub } }
  })
  await flushPromises()
  return { settingsStore, wrapper }
}

describe("TutorialHost", () => {
  it("maps automatic eligibility to the UI adapter and records completion", async () => {
    const { settingsStore, wrapper } = await mountHost()
    const markCompleted = vi.spyOn(settingsStore, "markTutorialCompleted").mockResolvedValue(true)
    const tour = wrapper.findComponent(GuidedTourStub)
    expect(tour.props("active")).toBe(true)
    expect(tour.props("steps")).toHaveLength(7)
    tour.vm.$emit("complete")
    await flushPromises()
    expect(markCompleted).toHaveBeenCalledWith("studio-basics", 1)
    expect(tour.props("active")).toBe(false)
  })

  it("keeps manual replay available when automatic tutorials are disabled", async () => {
    const { wrapper } = await mountHost({ autoStart: false, completed: true })
    const tour = wrapper.findComponent(GuidedTourStub)
    expect(tour.props("active")).toBe(false)
    useTutorialController().requestStudioBasics()
    await flushPromises()
    expect(tour.props("active")).toBe(true)
  })
})
