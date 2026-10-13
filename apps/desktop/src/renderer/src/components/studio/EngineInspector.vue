<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { intlLocale } from "../../i18n"
import { Activity, Cpu, Zap } from "@lucide/vue"
import { UiButton, UiSlider } from "@heron/ui"
import type { AudioRuntimeSnapshot } from "@heron/contracts"

const props = defineProps<{ runtime: AudioRuntimeSnapshot; peak?: number; error?: string }>()
const emit = defineEmits<{ runPreview: [] }>()
const gainValues = defineModel<number[]>({ required: true })
const { t, locale } = useI18n()
const formattingLocale = computed(() => intlLocale(locale.value))
const gain = computed(() => gainValues.value[0] ?? 0.5)
const gainValue = computed({
  get: () => gain.value,
  set: (value: number) => {
    gainValues.value = [value]
  }
})
const meterLevel = computed(() =>
  Math.max(1, Math.min(12, Math.round((props.peak ?? gain.value / 2) * 12)))
)
const meterSegments = Array.from({ length: 12 }, (_, index) => index)
</script>

<template>
  <aside class="inspector-panel">
    <div class="panel-heading">
      <div>
        <span>{{ t("studio.inspector.eyebrow") }}</span
        ><strong>{{ t("studio.inspector.title") }}</strong>
      </div>
      <Activity :size="15" aria-hidden="true" />
    </div>
    <p class="panel-description">
      {{ t("studio.inspector.description") }}
    </p>
    <div class="signal-card">
      <div class="signal-card-header">
        <span>{{ t("studio.inspector.outputPeak") }}</span
        ><output>{{ peak === undefined ? "—" : peak.toFixed(3) }}</output>
      </div>
      <div class="meter" :aria-label="t('studio.inspector.outputPeakMeter')">
        <span
          v-for="segment in meterSegments"
          :key="segment"
          :class="{ active: segment < meterLevel, hot: segment > 9 }"
        />
      </div>
      <div class="meter-scale"><span>−∞</span><span>−12</span><span>−6</span><span>0 dB</span></div>
    </div>
    <label class="gain-label" for="gain"
      >{{ t("studio.inspector.offlineGain") }} <output>{{ gain.toFixed(2) }}</output></label
    >
    <UiSlider
      id="gain"
      v-model="gainValue"
      class="gain-slider"
      :label="t('studio.inspector.offlineGain')"
      :value-text="gain.toFixed(2)"
      :min="0"
      :max="2"
      :step="0.01"
    />
    <UiButton class="primary-action" variant="primary" @click="emit('runPreview')">
      <Zap :size="13" />{{ t("studio.inspector.runSignalCheck") }}
    </UiButton>
    <hr class="panel-separator" />
    <div class="telemetry-heading">
      <Cpu :size="12" /><span>{{ t("studio.inspector.nativeTelemetry") }}</span>
    </div>
    <dl>
      <div>
        <dt>{{ t("studio.inspector.input") }}</dt>
        <dd>−0.50 · 0.25 · 1.00</dd>
      </div>
      <div>
        <dt>{{ t("studio.inspector.audioIo") }}</dt>
        <dd>Rust · CPAL</dd>
      </div>
      <div>
        <dt>{{ t("studio.inspector.sampleRate") }}</dt>
        <dd>
          {{
            runtime.sampleRate ? `${runtime.sampleRate.toLocaleString(formattingLocale)} Hz` : "—"
          }}
        </dd>
      </div>
      <div>
        <dt>{{ t("studio.inspector.clockSync") }}</dt>
        <dd>{{ runtime.clockSync.replace("-", " ") }}</dd>
      </div>
    </dl>
    <div v-if="error" class="error-message">{{ error }}</div>
  </aside>
</template>

<style scoped>
.inspector-panel {
  min-width: 0;
  padding: 17px 14px;
  border-left: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface-sunken);
  overflow: auto;
}
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-heading > div span,
.panel-heading > div strong {
  display: block;
}
.panel-heading span {
  color: var(--ui-color-accent);
  font: var(--ui-type-weight-strong) var(--ui-type-size-caption) var(--ui-type-family-interface);
  letter-spacing: var(--ui-type-tracking-eyebrow);
  text-transform: uppercase;
}
.panel-heading strong {
  margin-top: 5px;
  color: var(--ui-color-text);
  font-family: var(--ui-type-family-display);
  font-size: var(--ui-type-size-panel-title);
  font-weight: var(--ui-type-weight-heavy);
  letter-spacing: var(--ui-type-tracking-display);
}
.panel-heading > svg {
  color: var(--ui-signal-audio);
}
.panel-description {
  margin: 14px 0 17px;
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-body-compact);
  line-height: var(--ui-type-leading-normal);
}
.signal-card {
  padding: 11px;
  border: 1px solid var(--ui-color-glass-edge);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-color-fill);
}
.signal-card-header,
.gain-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.signal-card-header span,
.gain-label {
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-control);
}
.signal-card-header output,
.gain-label output {
  color: var(--ui-signal-audio);
  font: var(--ui-type-size-body-compact) var(--ui-type-family-data);
}
.meter {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  height: 38px;
  align-items: end;
  gap: 3px;
  margin-top: 9px;
}
.meter span {
  height: 28%;
  border-radius: var(--ui-radius-xs);
  background: var(--ui-color-fill-hover);
  transition:
    height var(--ui-motion-fast) var(--ui-ease-standard),
    background var(--ui-motion-fast) var(--ui-ease-standard);
}
.meter span:nth-child(3n + 2) {
  height: 42%;
}
.meter span:nth-child(3n) {
  height: 62%;
}
.meter span.active {
  height: 100%;
  background: var(--ui-signal-audio);
}
.meter span.active.hot {
  background: var(--ui-signal-record);
}
.meter-scale {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  color: var(--ui-color-text-faint);
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
}
.gain-label {
  margin-top: 17px;
}
.gain-slider {
  margin: 5px 0 12px;
}
.primary-action {
  width: 100%;
}
.panel-separator {
  border: 0;
  width: 100%;
  height: 1px;
  margin: 18px 0 12px;
  background: var(--ui-color-border);
}
.telemetry-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-color-text-subtle);
  font: var(--ui-type-weight-strong) var(--ui-type-size-caption) var(--ui-type-family-interface);
  letter-spacing: var(--ui-type-tracking-eyebrow);
  text-transform: uppercase;
}
.inspector-panel dl {
  margin: 9px 0 0;
}
.inspector-panel dl div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--ui-color-border);
  font-size: var(--ui-type-size-control);
}
.inspector-panel dt {
  color: var(--ui-color-text-faint);
}
.inspector-panel dd {
  margin: 0;
  overflow: hidden;
  color: var(--ui-color-text-muted);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.error-message {
  margin-top: 12px;
  padding: 9px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-md);
  color: var(--ui-color-danger);
  background: color-mix(in srgb, var(--ui-color-danger) 16%, transparent);
  font-size: var(--ui-type-size-control);
  line-height: var(--ui-type-leading-normal);
}
</style>
