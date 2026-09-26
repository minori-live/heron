<script setup lang="ts">
import { toRef } from "vue"
import { UiHorizontalFader } from "@heron/ui"
import {
  DEFAULT_METER_RETURN_RATE,
  type MeterPeakHold,
  type MeterReturnRate,
  type MixerChannelMeter
} from "@heron/contracts"
import { FADER_MAX_DB, FADER_MIN_DB } from "../../utils/mixerDbScale"
import { usePeakMeterDisplay } from "../../composables/usePeakMeterDisplay"

const props = withDefaults(
  defineProps<{
    channelName: string
    value: number
    meter: MixerChannelMeter
    meterPeakHold?: MeterPeakHold
    meterReturnRate?: MeterReturnRate
    disabled?: boolean
  }>(),
  { meterPeakHold: "800ms", meterReturnRate: DEFAULT_METER_RETURN_RATE }
)
const emit = defineEmits<{ preview: [value: number]; commit: [value: number] }>()
const valueText = (value: number) => (value <= FADER_MIN_DB ? "−∞ dB" : `${value.toFixed(1)} dB`)
const meterDisplay = usePeakMeterDisplay({
  meter: toRef(props, "meter"),
  peakHold: toRef(props, "meterPeakHold"),
  returnRate: toRef(props, "meterReturnRate")
})
</script>

<template>
  <UiHorizontalFader
    class="mixer-quick-gain"
    :value="value"
    :min="FADER_MIN_DB"
    :max="FADER_MAX_DB"
    :step="0.1"
    :default-value="0"
    :label="`${channelName} quick volume`"
    :value-text="valueText"
    :meter-level-percent="meterDisplay.meterLevelPercent.value"
    :disabled="disabled"
    @preview="emit('preview', $event)"
    @commit="emit('commit', $event)"
  />
</template>
