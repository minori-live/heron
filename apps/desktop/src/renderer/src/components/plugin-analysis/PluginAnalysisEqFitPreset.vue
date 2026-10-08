<script setup lang="ts">
import { computed, shallowRef } from "vue"
import { useI18n } from "vue-i18n"
import { UiButton, UiTextarea } from "@heron/ui"
import { heronEqPreset } from "../../lib/eq-fit/preset"
import type { EqFitSuccess } from "./eqFitWorkerTypes"

const props = defineProps<{ result: EqFitSuccess }>()
const { t } = useI18n()
const expanded = shallowRef(false)
const preset = computed(() => heronEqPreset(props.result.sections, props.result.overallGainDb))
</script>

<template>
  <div class="fit-preset">
    <UiButton size="sm" variant="secondary" :aria-expanded="expanded" @click="expanded = !expanded">
      {{ t("pluginAnalysis.eqFit.preset") }}
    </UiButton>
    <template v-if="expanded">
      <p class="fit-preset-help">{{ t("pluginAnalysis.eqFit.presetHelp") }}</p>
      <UiTextarea
        :model-value="preset"
        readonly
        :rows="8"
        :aria-label="t('pluginAnalysis.eqFit.preset')"
      />
    </template>
  </div>
</template>

<style scoped>
.fit-preset {
  margin-block: 12px;
}
.fit-preset-help {
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-caption);
}
</style>
