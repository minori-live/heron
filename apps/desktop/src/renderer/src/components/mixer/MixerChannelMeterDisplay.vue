<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { computed, inject, shallowRef } from "vue"
import { storeToRefs } from "pinia"
import { DEFAULT_METER_RETURN_RATE } from "@heron/contracts"
import type {
  ApplicationSettings,
  MeterPeakHold,
  MeterReturnRate,
  MixerChannelMeter
} from "@heron/contracts"
import { UiButton, UiLevelMeter } from "@heron/ui"
import { usePeakMeterDisplay } from "../../composables/usePeakMeterDisplay"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useMixerRuntimeStore } from "../../stores/mixerRuntime"
import { METER_SCALE_MARKS } from "../../utils/mixerDbScale"
import type { MixerStripDisplayOptions } from "./mixer-strip-display-options"
import { mixerMeterSourceKey } from "./mixer-surface-context"

const { t } = useI18n()

const props = defineProps<{
  channelId: string
  channelName: string
  meter?: MixerChannelMeter
  displayOptions?: MixerStripDisplayOptions
}>()
const emit = defineEmits<{
  resetMeterClips: []
}>()

// Tests and static previews can provide a meter directly. Production instances subscribe here so
// a 30 Hz runtime update invalidates only this small display rather than the full channel strip.
const meterSource = inject(mixerMeterSourceKey, null)
const runtimeStore = meterSource ? null : useMixerRuntimeStore()
const settingsStore = props.displayOptions ? null : useApplicationSettingsStore()
const settings = settingsStore
  ? storeToRefs(settingsStore).settings
  : shallowRef<ApplicationSettings | null>(null)
const meter = computed<MixerChannelMeter>(
  () =>
    props.meter ??
    meterSource?.(props.channelId) ??
    runtimeStore?.meterFor(props.channelId) ?? {
      channelId: props.channelId,
      preFaderPeak: [0, 0],
      postFaderPeak: [0, 0],
      heldPeak: [0, 0],
      clipped: false
    }
)
const peakHold = computed<MeterPeakHold>(
  () => props.displayOptions?.meterPeakHold ?? settings.value?.meterPeakHold ?? "800ms"
)
const returnRate = computed<MeterReturnRate>(
  () =>
    props.displayOptions?.meterReturnRate ??
    settings.value?.meterReturnRate ??
    DEFAULT_METER_RETURN_RATE
)
const meterDisplay = usePeakMeterDisplay({ meter, peakHold, returnRate })
const maximumPeakLabel = computed(() =>
  Number.isFinite(meterDisplay.latchedPeakDb.value)
    ? meterDisplay.latchedPeakDb.value.toFixed(1)
    : "−∞"
)
const maximumPeakState = computed(() => ({
  active: Number.isFinite(meterDisplay.latchedPeakDb.value),
  hot: meterDisplay.latchedPeakDb.value >= -6,
  clipped: meterDisplay.clipped.value
}))

function resetMaximumPeak(): void {
  meterDisplay.resetPeakAndClip()
  emit("resetMeterClips")
}
</script>

<template>
  <div class="meter-display">
    <UiButton
      size="sm"
      variant="ghost"
      :class="['maximum-peak-value', maximumPeakState]"
      :aria-label="t('mixer.meter.maximumAria', { name: channelName })"
      :title="t('mixer.meter.maximumTitle', { peak: maximumPeakLabel })"
      @click="resetMaximumPeak"
    >
      {{ maximumPeakLabel }}
    </UiButton>
    <UiLevelMeter
      class="meter-rack"
      :channels="meterDisplay.meterChannels.value"
      :clipped="meterDisplay.clipped.value"
      :marks="METER_SCALE_MARKS"
      :label="t('mixer.meter.levelAria', { name: channelName })"
    />
  </div>
</template>

<style scoped>
.meter-display {
  display: contents;
}
.meter-rack {
  grid-column: 2;
  grid-row: 2;
  margin-block: 8px;
}
.maximum-peak-value {
  display: grid;
  grid-column: 2;
  grid-row: 1;
  place-items: center;
  width: 34px;
  height: 20px;
  overflow: hidden;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: 2px;
  color: var(--ui-color-text-subtle);
  background: var(--ui-daw-meter-well);
  font: var(--ui-type-size-control) var(--ui-type-family-data);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.maximum-peak-value.active {
  color: var(--ui-signal-mixer-pan);
}
.maximum-peak-value.hot {
  color: var(--ui-signal-mixer-solo);
}
.maximum-peak-value.clipped {
  border-color: var(--ui-signal-record);
  color: var(--ui-signal-record);
  background: color-mix(in srgb, var(--ui-signal-record) 14%, var(--ui-daw-meter-well));
}
</style>
