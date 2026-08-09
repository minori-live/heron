import { computed, shallowRef, watch } from "vue"
import type { Ref } from "vue"
import { METER_RETURN_RATE_DB_PER_SECOND } from "@heron/contracts"
import type { MeterPeakHold, MeterReturnRate, MixerChannelMeter } from "@heron/contracts"
import { dbToLevelPercent, METER_MAX_DB, METER_MIN_DB } from "../utils/mixerDbScale"

const PEAK_HOLD_DURATION_MS: Record<MeterPeakHold, number> = {
  "800ms": 800,
  "2s": 2_000,
  "4s": 4_000,
  infinite: Number.POSITIVE_INFINITY
}

function amplitudeToDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY
}

function decay(db: number, elapsedSeconds: number, rate: number): number {
  if (!Number.isFinite(db)) return Number.NEGATIVE_INFINITY
  const next = db - elapsedSeconds * rate
  return next <= METER_MIN_DB ? Number.NEGATIVE_INFINITY : next
}

type StereoValue<T> = [T, T]

function maximum(values: StereoValue<number>): number {
  return Math.max(...values)
}

export function usePeakMeterDisplay(options: {
  meter: Readonly<Ref<MixerChannelMeter>>
  peakHold: Readonly<Ref<MeterPeakHold>>
  returnRate: Readonly<Ref<MeterReturnRate>>
  now?: () => number
}) {
  const now = options.now ?? (() => performance.now())
  const currentPeakDbByChannel = computed<StereoValue<number>>(
    () => options.meter.value.postFaderPeak.map(amplitudeToDb) as StereoValue<number>
  )
  const currentPeakDb = computed(() => maximum(currentPeakDbByChannel.value))
  const displayedPeakDbByChannel = shallowRef<StereoValue<number>>([
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ])
  const heldPeakDbByChannel = shallowRef<StereoValue<number>>([
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ])
  const displayedPeakDb = computed(() => maximum(displayedPeakDbByChannel.value))
  const heldPeakDb = computed(() => maximum(heldPeakDbByChannel.value))
  const latchedPeakDb = shallowRef(Number.NEGATIVE_INFINITY)
  const clipped = shallowRef(false)
  let lastUpdate = now()
  const holdUntil: StereoValue<number> = [0, 0]
  let ignoreClipUntilCleared = false

  watch(
    [options.meter, options.peakHold, options.returnRate],
    ([meter, peakHold, returnRate]) => {
      const timestamp = now()
      const elapsedSeconds = Math.max(0, timestamp - lastUpdate) / 1_000
      const inputPeakDb = currentPeakDbByChannel.value
      const rate = METER_RETURN_RATE_DB_PER_SECOND[returnRate]

      latchedPeakDb.value = Math.max(latchedPeakDb.value, maximum(inputPeakDb))
      const nextDisplayedPeakDb: StereoValue<number> = [...displayedPeakDbByChannel.value]
      const nextHeldPeakDb: StereoValue<number> = [...heldPeakDbByChannel.value]
      for (const channel of [0, 1] as const) {
        nextDisplayedPeakDb[channel] =
          !Number.isFinite(nextDisplayedPeakDb[channel]) ||
          inputPeakDb[channel] >= nextDisplayedPeakDb[channel]
            ? inputPeakDb[channel]
            : Math.max(
                inputPeakDb[channel],
                decay(nextDisplayedPeakDb[channel], elapsedSeconds, rate)
              )

        if (
          !Number.isFinite(nextHeldPeakDb[channel]) ||
          inputPeakDb[channel] >= nextHeldPeakDb[channel]
        ) {
          nextHeldPeakDb[channel] = inputPeakDb[channel]
          holdUntil[channel] = Number.isFinite(PEAK_HOLD_DURATION_MS[peakHold])
            ? timestamp + PEAK_HOLD_DURATION_MS[peakHold]
            : Number.POSITIVE_INFINITY
        } else if (timestamp >= holdUntil[channel]) {
          const returnElapsedSeconds =
            Math.max(0, timestamp - Math.max(lastUpdate, holdUntil[channel])) / 1_000
          nextHeldPeakDb[channel] = Math.max(
            inputPeakDb[channel],
            decay(nextHeldPeakDb[channel], returnElapsedSeconds, rate)
          )
        }
      }
      displayedPeakDbByChannel.value = nextDisplayedPeakDb
      heldPeakDbByChannel.value = nextHeldPeakDb

      if (!meter.clipped) {
        ignoreClipUntilCleared = false
        clipped.value = false
      } else if (!ignoreClipUntilCleared) {
        clipped.value = true
      }
      lastUpdate = timestamp
    },
    { immediate: true }
  )

  const meterLevelPercent = computed(() =>
    dbToLevelPercent(displayedPeakDb.value, METER_MIN_DB, METER_MAX_DB)
  )
  const meterChannels = computed(() =>
    displayedPeakDbByChannel.value.map((level, channel) => ({
      levelPercent: dbToLevelPercent(level, METER_MIN_DB, METER_MAX_DB),
      heldLevelPercent: dbToLevelPercent(
        heldPeakDbByChannel.value[channel] ?? Number.NEGATIVE_INFINITY,
        METER_MIN_DB,
        METER_MAX_DB
      ),
      hasHeldPeak: Number.isFinite(heldPeakDbByChannel.value[channel])
    }))
  )

  function resetPeakAndClip(): void {
    ignoreClipUntilCleared = true
    clipped.value = false
    latchedPeakDb.value = Number.NEGATIVE_INFINITY
  }

  return {
    currentPeakDb,
    currentPeakDbByChannel,
    displayedPeakDb,
    displayedPeakDbByChannel,
    heldPeakDb,
    heldPeakDbByChannel,
    latchedPeakDb,
    clipped,
    meterLevelPercent,
    meterChannels,
    resetPeakAndClip
  }
}
