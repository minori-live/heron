import type { Decorator, Preview } from "@storybook/vue3-vite"
import { setup } from "@storybook/vue3"
import { createHead } from "@unhead/vue/client"
import { createPinia, setActivePinia } from "pinia"
import { onScopeDispose, watchEffect } from "vue"
import { withThemeByDataAttribute } from "@storybook/addon-themes"

import { UiProvider } from "@heron/ui"
import { useLocaleFonts } from "@heron/ui/locale-fonts"
import "unfonts.css"
import "@heron/ui/styles.css"
import "virtual:uno.css"
import "./preview.css"

setup((app) => {
  app.use(createHead())
})

const withIsolatedUiContext: Decorator = (story, context) => ({
  components: { story, UiProvider },
  setup() {
    setActivePinia(createPinia())
    useLocaleFonts("en-US")
    // Overlays teleport to body, outside the story's stage.
    const previousMotion = document.body.dataset.uiMotion
    watchEffect(() => {
      document.body.dataset.uiMotion = context.globals.motion === "enabled" ? "enabled" : "disabled"
    })
    onScopeDispose(() => {
      if (previousMotion === undefined) delete document.body.dataset.uiMotion
      else document.body.dataset.uiMotion = previousMotion
    })
    return {}
  },
  template: `
    <div class="storybook-stage">
      <UiProvider>
        <story />
      </UiProvider>
    </div>
  `
})

const preview: Preview = {
  decorators: [
    withThemeByDataAttribute({
      themes: {
        dark: "dark",
        light: "light"
      },
      defaultTheme: "dark",
      attributeName: "data-theme"
    }),
    withIsolatedUiContext
  ],
  globalTypes: {
    motion: {
      description: "Enable production motion for motion-specific stories.",
      defaultValue: "disabled",
      toolbar: {
        icon: "play",
        items: [
          { value: "disabled", title: "Motion disabled" },
          { value: "enabled", title: "Motion enabled" }
        ]
      }
    }
  },
  parameters: {
    a11y: {
      test: "error"
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i
      }
    },
    options: {
      storySort: {
        order: ["Foundations", "Components", "Patterns", "Product examples"]
      }
    },
    backgrounds: {
      disable: true
    }
  }
}

export default preview
