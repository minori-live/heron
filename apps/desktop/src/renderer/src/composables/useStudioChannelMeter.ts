import { computed } from "vue"
import { storeToRefs } from "pinia"
import { DEFAULT_METER_RETURN_RATE, type MixerChannelMeter } from "@heron/contracts"
import { useApplicationSettingsStore } from "../stores/applicationSettings"
import { useMixerRuntimeStore } from "../stores/mixerRuntime"

/** Resolve Studio telemetry only within a leaf control, never in the workspace composition. */
export function useStudioChannelMeter(
  channelId: () => string | undefined,
  suppliedMeter: () => MixerChannelMeter | undefined
) {
  const runtimeStore = suppliedMeter() ? null : useMixerRuntimeStore()
  const { settings } = storeToRefs(useApplicationSettingsStore())
  const meter = computed<MixerChannelMeter>(
    () =>
      suppliedMeter() ??
      runtimeStore?.meterFor(channelId() ?? "") ?? {
        channelId: channelId() ?? "",
        preFaderPeak: [0, 0],
        postFaderPeak: [0, 0],
        heldPeak: [0, 0],
        clipped: false
      }
  )
  const meterPeakHold = computed(() => settings.value?.meterPeakHold ?? "800ms")
  const meterReturnRate = computed(
    () => settings.value?.meterReturnRate ?? DEFAULT_METER_RETURN_RATE
  )
  return { meter, meterPeakHold, meterReturnRate }
}
