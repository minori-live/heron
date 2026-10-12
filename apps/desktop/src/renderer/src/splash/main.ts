import { createHead } from "@unhead/vue/client"
import { createApp, vaporInteropPlugin } from "vue"
import { i18n } from "../i18n"
import type { DefineComponent } from "vue"
import { createPinia } from "pinia"
import SplashApp from "./SplashApp.vue"
import "unfonts.css"
import "@heron/ui/styles.css"
import "../uno"

const app = createApp(SplashApp as DefineComponent)
app.use(vaporInteropPlugin)
app.use(createPinia())
app.use(createHead())
app.use(i18n)
app.mount("#splash-root")
