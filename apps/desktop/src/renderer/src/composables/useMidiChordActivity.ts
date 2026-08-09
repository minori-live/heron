import { computed, onMounted, toValue } from "vue"
import type { MaybeRefOrGetter } from "vue"
import { storeToRefs } from "pinia"
import type { KeySignatureEventState, MixerChannelState } from "@heron/contracts"
import { useMidiInputStore } from "../stores/midiInput"
import { recognizeMidiChord, routedMidiKeys } from "../utils/midiChordRecognition"

interface UseMidiChordActivityOptions {
  channels: MaybeRefOrGetter<readonly MixerChannelState[]>
  keySignature: MaybeRefOrGetter<KeySignatureEventState>
}

export function useMidiChordActivity(options: UseMidiChordActivityOptions) {
  const midiInputStore = useMidiInputStore()
  const { snapshot } = storeToRefs(midiInputStore)

  onMounted(() => void midiInputStore.load())

  const label = computed(() =>
    recognizeMidiChord(
      routedMidiKeys(snapshot.value.activeNotes, toValue(options.channels)),
      toValue(options.keySignature)
    )
  )

  return { label }
}
