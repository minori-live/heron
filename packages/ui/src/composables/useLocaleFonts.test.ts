import { createHead, renderDOMHead } from "@unhead/vue/client"
import { mount } from "@vue/test-utils"
import { createApp, defineComponent, effectScope, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useLocaleFonts } from "./useLocaleFonts"

const loadHansFonts = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock("@fontsource-variable/noto-sans-sc/wght.css", () => {
  void loadHansFonts()
  return {}
})

describe("useLocaleFonts", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("lang")
    loadHansFonts.mockClear()
  })

  it("sets html lang for the active locale and loads Hans fonts for Chinese", async () => {
    const locale = ref("en-US")
    const head = createHead()
    const Host = defineComponent({
      setup() {
        useLocaleFonts(locale)
        return () => null
      }
    })
    const wrapper = mount(Host, {
      global: {
        plugins: [head]
      }
    })

    await nextTick()
    renderDOMHead(head)
    expect(document.documentElement.lang).toBe("en-US")
    expect(loadHansFonts).not.toHaveBeenCalled()

    locale.value = "zh-cmn-Hans-CN"
    await nextTick()
    renderDOMHead(head)
    expect(document.documentElement.lang).toBe("zh-CN")
    await vi.waitFor(() => {
      expect(loadHansFonts).toHaveBeenCalled()
    })
    wrapper.unmount()
  })

  it("removes the document locale when its owning effect scope stops", () => {
    const head = createHead()
    const app = createApp({})
    app.use(head)
    const scope = effectScope()

    app.runWithContext(() => scope.run(() => useLocaleFonts("en-US")))
    renderDOMHead(head)
    expect(document.documentElement.lang).toBe("en-US")

    scope.stop()
    renderDOMHead(head)
    expect(document.documentElement.hasAttribute("lang")).toBe(false)
  })
})
