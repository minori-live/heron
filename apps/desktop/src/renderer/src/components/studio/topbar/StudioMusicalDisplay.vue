<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiInlineTextEdit } from "@heron/ui"
import type {
  KeySignatureEventState,
  KeySignatureMode,
  MixerChannelState,
  TempoMapSnapshot,
  TimeSignatureEventState
} from "@heron/contracts"
import {
  musicalPositionAtTick,
  secondsToTick,
  tempoAtTick,
  timeSignatureAtTick
} from "../../../utils/tempoMap"
import {
  keySignatureAtTick,
  keySignatureLabel,
  keySignatureValue,
  parseKeySignatureValue
} from "../../../utils/keySignatures"
import KeySignatureDropdown from "../KeySignatureDropdown.vue"
import { useMidiChordActivity } from "../../../composables/useMidiChordActivity"

const props = defineProps<{
  playheadSeconds: number
  tempoMap: TempoMapSnapshot
  keySignatureEvents: KeySignatureEventState[]
  mixerChannels: MixerChannelState[]
}>()
const emit = defineEmits<{
  updateTempo: [beatsPerMinute: number]
  updateMeter: [signature: Pick<TimeSignatureEventState, "numerator" | "denominator">]
  updateKey: [signature: { fifths: number; mode: KeySignatureMode }]
}>()

const { t } = useI18n()
const MINIMUM_TEMPO = 20
const MAXIMUM_TEMPO = 300
const METER_DENOMINATORS = [1, 2, 4, 8, 16, 32]
const playheadTick = computed(() => secondsToTick(props.tempoMap, props.playheadSeconds))
const musicalPosition = computed(() => musicalPositionAtTick(props.tempoMap, playheadTick.value))
const currentTempo = computed(() => tempoAtTick(props.tempoMap, playheadTick.value))
const currentSignature = computed(() => timeSignatureAtTick(props.tempoMap, playheadTick.value))
const currentKey = computed(() => keySignatureAtTick(props.keySignatureEvents, playheadTick.value))
const currentKeyLabel = computed(() =>
  keySignatureLabel(currentKey.value.fifths, currentKey.value.mode)
)
const currentKeyValue = computed({
  get: () => keySignatureValue(currentKey.value.fifths, currentKey.value.mode),
  set: (value: string) => {
    const choice = parseKeySignatureValue(value)
    if (!choice) return
    if (choice.fifths !== currentKey.value.fifths || choice.mode !== currentKey.value.mode) {
      emit("updateKey", choice)
    }
  }
})
const { label: midiChordLabel } = useMidiChordActivity({
  channels: () => props.mixerChannels,
  keySignature: currentKey
})

function commitTempoEdit(value: string): void {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return
  const normalized =
    Math.round(Math.min(MAXIMUM_TEMPO, Math.max(MINIMUM_TEMPO, parsed)) * 100) / 100
  if (normalized !== currentTempo.value) emit("updateTempo", normalized)
}

function commitMeterEdit(value: string): void {
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(value)
  if (!match) return
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (numerator < 1 || numerator > 32 || !METER_DENOMINATORS.includes(denominator)) return
  if (
    numerator !== currentSignature.value.numerator ||
    denominator !== currentSignature.value.denominator
  ) {
    emit("updateMeter", { numerator, denominator })
  }
}
</script>

<template>
  <section class="musical-display" :aria-label="t('studio.musical.ariaLabel')">
    <div class="position-cell bar-cell">
      <strong>{{ String(musicalPosition.bar).padStart(3, "0") }}</strong>
      <span>{{ t("studio.musical.bar") }}</span>
    </div>
    <div class="position-cell beat-cell">
      <strong>{{ musicalPosition.beat }}</strong>
      <span>{{ t("studio.musical.beat") }}</span>
    </div>
    <div class="lcd-cell tempo-cell">
      <UiInlineTextEdit
        class="tempo-value"
        :value="currentTempo.toFixed(2)"
        :label="t('studio.musical.tempoButtonAria', { value: currentTempo.toFixed(2) })"
        :edit-label="t('studio.musical.editTempoAria')"
        @commit="commitTempoEdit"
      />
      <span>{{ t("studio.musical.tempo") }}</span>
    </div>
    <div class="lcd-cell signature-cell">
      <UiInlineTextEdit
        class="meter-value"
        :value="`${currentSignature.numerator}/${currentSignature.denominator}`"
        :label="
          t('studio.musical.meterButtonAria', {
            value: `${currentSignature.numerator}/${currentSignature.denominator}`
          })
        "
        :edit-label="t('studio.musical.editMeterAria')"
        @commit="commitMeterEdit"
      />
      <span>{{ t("studio.musical.meter") }}</span>
    </div>
    <div
      class="lcd-cell harmony-cell"
      :aria-label="midiChordLabel ? t('studio.musical.midiInputAria') : undefined"
    >
      <template v-if="midiChordLabel">
        <strong class="midi-value">{{ midiChordLabel }}</strong>
        <span>{{ t("studio.musical.midiInput") }}</span>
      </template>
      <template v-else>
        <KeySignatureDropdown
          v-model="currentKeyValue"
          class="key-dropdown"
          appearance="embedded"
          hover-treatment="host-tint"
          :aria-label="t('studio.musical.keyButtonAria', { value: currentKeyLabel })"
        />
        <span class="key-label">{{ t("studio.musical.key") }}</span>
      </template>
    </div>
  </section>
</template>

<style scoped>
.musical-display {
  display: grid;
  grid-template-columns: 74px 42px 65px 52px 88px;
  align-self: stretch;
  min-width: 0;
  height: 44px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  color: var(--text-secondary);
  background: var(--surface-sunken);
  box-shadow:
    0 1px 0 var(--ui-domain-color-ffffff08) inset,
    0 7px 18px var(--shadow);
  overflow: hidden;
  -webkit-app-region: no-drag;
}
.position-cell,
.lcd-cell {
  display: grid;
  min-width: 0;
  align-content: center;
  justify-items: center;
  border-left: 1px solid var(--line-soft);
}
.bar-cell {
  border-left: 0;
}
.position-cell strong,
.lcd-cell strong,
.tempo-value,
.meter-value,
.key-dropdown {
  height: 22px;
  color: var(--text-primary);
  font: var(--ui-type-weight-medium) var(--ui-type-size-feature-title) / var(--ui-type-leading-none)
    var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-tight);
  text-shadow: 0 0 12px color-mix(in srgb, var(--signal-cyan) 23%, transparent);
}
.position-cell > span,
.lcd-cell > span {
  color: var(--text-faint);
  font: var(--ui-type-weight-semibold) var(--ui-type-size-micro) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wider);
}
.tempo-value {
  width: 100%;
  padding: 0 4px;
  border: 0;
  background: transparent;
  text-align: center;
}
.meter-value {
  width: 100%;
  min-width: 0;
  padding: 0 2px;
  border: 0;
  background: transparent;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.key-dropdown {
  width: 100%;
  min-width: 0;
  min-height: 22px;
  padding: 0 4px;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-size: var(--ui-type-size-control);
  text-align: center;
}
.harmony-cell {
  overflow: hidden;
}
.midi-value {
  width: 100%;
  overflow: hidden;
  padding: 0 4px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 1279px) {
  .musical-display {
    grid-template-columns: 68px 38px 62px 48px 76px;
  }
}
@media (max-width: 1023px) {
  .key-label {
    display: none;
  }
}
</style>
