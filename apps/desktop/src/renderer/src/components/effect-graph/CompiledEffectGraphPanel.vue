<script setup lang="ts">
import { computed, shallowRef } from "vue"
import { useI18n } from "vue-i18n"
import { intlLocale } from "../../i18n"
import type { CompiledAudioGraphSnapshot } from "@heron/contracts"
import { UiButton } from "@heron/ui"
import type { CompiledEffectGraphStatus } from "../../stores/compiledEffectGraph"
import CompiledEffectGraphChart from "./CompiledEffectGraphChart.vue"

defineProps<{
  status: CompiledEffectGraphStatus
  snapshot: CompiledAudioGraphSnapshot | null
  errorMessage: string
}>()

const emit = defineEmits<{ retry: [] }>()
const { t, locale } = useI18n()
const formattingLocale = computed(() => intlLocale(locale.value))
const resetToken = shallowRef(0)
</script>

<template>
  <section class="compiled-effect-graph-panel">
    <header class="graph-toolbar">
      <div>
        <span>{{ t("effectGraph.toolbar.nativeCompile") }}</span>
        <strong v-if="snapshot">
          {{
            t("effectGraph.toolbar.revision", {
              revision: snapshot.graphRevision,
              build: snapshot.buildGeneration,
              sampleRate: snapshot.sampleRate.toLocaleString(formattingLocale)
            })
          }}
        </strong>
        <strong v-else>{{ t("effectGraph.toolbar.waiting") }}</strong>
      </div>
      <UiButton size="sm" :disabled="!snapshot" @click="resetToken += 1">
        {{ t("effectGraph.toolbar.resetView") }}
      </UiButton>
    </header>

    <CompiledEffectGraphChart
      v-if="status === 'ready' && snapshot"
      :snapshot="snapshot"
      :reset-token="resetToken"
    />
    <div v-else class="graph-state" role="status">
      <template v-if="status === 'loading'">
        <b>{{ t("effectGraph.state.loading.title") }}</b>
        <span>{{ t("effectGraph.state.loading.description") }}</span>
      </template>
      <template v-else-if="status === 'empty'">
        <b>{{ t("effectGraph.state.empty.title") }}</b>
        <span>{{ t("effectGraph.state.empty.description") }}</span>
      </template>
      <template v-else-if="status === 'error'">
        <b>{{ t("effectGraph.state.error.title") }}</b>
        <span>{{ errorMessage }}</span>
        <UiButton size="sm" @click="emit('retry')">
          {{ t("effectGraph.state.error.retry") }}
        </UiButton>
      </template>
    </div>
  </section>
</template>

<style scoped>
.compiled-effect-graph-panel {
  min-height: 560px;
  overflow: hidden;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: 7px;
  background: var(--ui-color-surface-raised);
}

.graph-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ui-color-border-strong);
  background: var(--ui-color-surface-raised);
}

.graph-toolbar div {
  display: grid;
  gap: 3px;
}

.graph-toolbar span {
  color: var(--ui-signal-mixer-input);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wider);
}

.graph-toolbar strong {
  color: var(--ui-color-text-muted);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}

.graph-toolbar button,
.graph-state button {
  padding: 6px 10px;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: 4px;
  color: var(--ui-color-text-muted);
  background: var(--ui-daw-control);
}

.graph-toolbar button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.graph-state {
  display: grid;
  place-content: center;
  justify-items: center;
  min-height: 510px;
  gap: 8px;
  padding: 30px;
  color: var(--ui-color-text-subtle);
  text-align: center;
}

.graph-state b {
  color: var(--ui-color-text);
}
</style>
