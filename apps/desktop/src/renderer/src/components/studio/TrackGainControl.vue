<script setup lang="ts">
import { computed } from "vue"
import { storeToRefs } from "pinia"
import { UiHorizontalFader } from "@heron/ui"
import {
  DEFAULT_METER_RETURN_RATE,
  type MeterPeakHold,
  type MeterReturnRate,
  type MixerChannelMeter
} from "@heron/contracts"
import { FADER_MAX_DB, FADER_MIN_DB } from "../../utils/mixerDbScale"
import { usePeakMeterDisplay } from "../../composables/usePeakMeterDisplay"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useMixerRuntimeStore } from "../../stores/mixerRuntime"
const props = defineProps<{
  channelName: string
  channelId?: string
  value: number
  meter?: MixerChannelMeter
  disabled?: boolean
}>()
const emit = defineEmits<{ preview: [value: number]; commit: [value: number] }>()
const valueText = (value: number) => (value <= FADER_MIN_DB ? "−∞ dB" : `${value.toFixed(1)} dB`)
// Keep the 30 Hz telemetry subscription inside this focused display so arrangement rows receive
// live levels without invalidating their composition surfaces. Tests and previews can still inject
// a deterministic meter through props.
const runtimeStore = useMixerRuntimeStore()
const { settings } = storeToRefs(useApplicationSettingsStore())
const meter = computed<MixerChannelMeter>(
  () => props.meter ?? runtimeStore.meterFor(props.channelId ?? "")
)
const peakHold = computed<MeterPeakHold>(() => settings.value?.meterPeakHold ?? "800ms")
const returnRate = computed<MeterReturnRate>(
  () => settings.value?.meterReturnRate ?? DEFAULT_METER_RETURN_RATE
)
const meterDisplay = usePeakMeterDisplay({
  meter,
  peakHold,
  returnRate
})
</script>

<template>
  <UiHorizontalFader
    class="track-gain"
    :value="props.value"
    :min="FADER_MIN_DB"
    :max="FADER_MAX_DB"
    :step="0.1"
    :default-value="0"
    :label="`${props.channelName} quick volume`"
    :value-text="valueText"
    :meter-level-percent="meterDisplay.meterLevelPercent.value"
    :disabled="props.disabled"
    @preview="emit('preview', $event)"
    @commit="emit('commit', $event)"
  />
</template>
