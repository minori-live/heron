import { createHead } from "@unhead/vue/client"
import { i18n } from "../i18n"
import { createApp } from "vue"
import type { DefineComponent } from "vue"
import { createPinia } from "pinia"
import SplashApp from "./SplashApp.vue"
import "unfonts.css"
import "@heron/ui/styles.css"
import "../uno"

const app = createApp(SplashApp as DefineComponent)
app.use(createPinia())
app.use(createHead())
app.use(i18n)
app.mount("#splash-root")
