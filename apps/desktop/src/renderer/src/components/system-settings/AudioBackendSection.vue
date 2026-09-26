<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiRadioGroup, type UiRadioOption } from "@heron/ui"
import SettingsSection from "../settings/SettingsSection.vue"
import AsioConfigurationNotice from "./AsioConfigurationNotice.vue"

const props = defineProps<{
  modelValue: string
  options: readonly UiRadioOption[]
  optionCount: number
  discoveryState: string
  disabled?: boolean
  layout?: "columns" | "stacked"
}>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()

const { t } = useI18n()
const hasAsioOption = computed(() => props.options.some((option) => option.value === "asio"))
</script>

<template>
  <SettingsSection
    :title="t('settings.audio.backend.title')"
    :description="t('settings.audio.backend.description')"
    :layout="layout"
  >
    <div class="backend-grid">
      <UiRadioGroup
        size="compact"
        :model-value="modelValue"
        :label="t('settings.audio.backend.ariaLabel')"
        :options="options"
        :disabled="disabled"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <p v-if="optionCount === 0" class="backend-empty">
        {{
          discoveryState === "loading"
            ? t("settings.audio.backend.scanning")
            : t("settings.audio.backend.unavailable")
        }}
      </p>
    </div>
    <AsioConfigurationNotice v-if="hasAsioOption" />
  </SettingsSection>
</template>

<style scoped>
.backend-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
}
.backend-empty {
  grid-column: 1 / -1;
  margin: 0;
  padding: 18px;
  border: 1px dashed var(--line-strong);
  border-radius: 7px;
  color: var(--text-muted);
  background: var(--surface-1);
  font-size: var(--ui-type-size-body-compact);
}
</style>
