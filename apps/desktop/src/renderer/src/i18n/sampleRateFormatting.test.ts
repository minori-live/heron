import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { INITIAL_AUDIO_RUNTIME_SNAPSHOT } from "@heron/contracts"
import CompiledEffectGraphPanel from "../components/effect-graph/CompiledEffectGraphPanel.vue"
import ProjectGeneralSettings from "../components/project-settings/ProjectGeneralSettings.vue"
import EngineInspector from "../components/studio/EngineInspector.vue"
import { i18n } from "./index"

const cases = [
  {
    name: "compiled effect graph",
    render: () =>
      mount(CompiledEffectGraphPanel, {
        props: {
          status: "ready",
          snapshot: {
            graphRevision: 1,
            buildGeneration: 1,
            sampleRate: 48_000,
            nodes: [],
            edges: []
          },
          errorMessage: ""
        },
        global: { stubs: { CompiledEffectGraphChart: true } }
      })
  },
  {
    name: "project sample-rate options",
    render: () =>
      mount(ProjectGeneralSettings, {
        props: {
          modelValue: {
            name: "Session",
            sampleRate: 48_000,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            waveformDisplayMode: "separate"
          }
        }
      })
  },
  {
    name: "engine inspector",
    render: () =>
      mount(EngineInspector, {
        props: {
          runtime: { ...INITIAL_AUDIO_RUNTIME_SNAPSHOT, sampleRate: 48_000 },
          modelValue: [0.5]
        }
      })
  }
]

afterEach(() => {
  i18n.global.locale.value = "en-US"
})

describe.each(cases)("$name locale formatting", ({ render }) => {
  it.each(["en-US", "zh-cmn-Hans-CN"] as const)(
    "passes Intl a locale string on mount in %s and after language changes",
    async (initialLocale) => {
      i18n.global.locale.value = initialLocale
      const format = vi.spyOn(Number.prototype, "toLocaleString")
      const wrapper = render()
      try {
        expect(format).toHaveBeenCalledWith(
          initialLocale === "zh-cmn-Hans-CN" ? "zh-Hans-CN" : "en-US"
        )
        const otherLocale = initialLocale === "en-US" ? "zh-cmn-Hans-CN" : "en-US"
        for (const locale of [otherLocale, initialLocale] as const) {
          format.mockClear()
          i18n.global.locale.value = locale
          await nextTick()
          const expected = locale === "zh-cmn-Hans-CN" ? "zh-Hans-CN" : "en-US"
          expect(format).toHaveBeenCalledWith(expected)
          expect(format.mock.calls.every(([value]) => typeof value === "string")).toBe(true)
          expect(wrapper.text()).toContain("48,000")
        }
      } finally {
        wrapper.unmount()
      }
    }
  )
})
