import { createApp } from "vue"
import { createPinia } from "pinia"
import { createHead } from "@unhead/vue/client"
import { i18n } from "./i18n"
import PluginAnalysisApp from "./components/plugin-analysis/PluginAnalysisApp.vue"
import "unfonts.css"
import "@heron/ui/styles.css"
import "./uno"
import "./styles.css"

createApp(PluginAnalysisApp).use(createPinia()).use(createHead()).use(i18n).mount("#root")
