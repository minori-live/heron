import { createI18n } from "vue-i18n"
import type { AppLocale } from "@heron/contracts"
import enUS from "../../../locales/en-US.json"
import zhCmnHansCN from "../../../locales/zh-cmn-Hans-CN.json"
import { DEFAULT_LOCALE } from "../../../shared/i18n"

export { intlLocale } from "../../../shared/i18n"

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: {
    "en-US": enUS,
    "zh-cmn-Hans-CN": zhCmnHansCN
  }
})

export function setAppLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
}

/**
 * Translate one message key from outside a component's setup scope. Stores,
 * composables and the dialog host share this so the global scope and the
 * parameter default are named once.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  return i18n.global.t(key, params ?? {})
}
