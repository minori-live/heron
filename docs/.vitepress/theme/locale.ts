import { computed, type ComputedRef } from "vue"
import { useData } from "vitepress"

export function useLocalePrefix(): ComputedRef<string> {
  const { localeIndex } = useData()
  return computed(() => (localeIndex.value === "root" ? "" : `/${localeIndex.value}`))
}
