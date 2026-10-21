import type { ComputedRef, InjectionKey } from "vue"

/** Live playhead reads for arrangement gestures.
 *
 * Membership strings change only when the playhead enters or leaves a clip.
 * Clip cards subscribe to that string, so playback inside one clip does not
 * re-render the card or its waveform.
 */
export interface ArrangementPlayheadSource {
  frame: () => number
  tick: () => number
  audioMembership: ComputedRef<string>
  midiMembership: ComputedRef<string>
}

export const arrangementPlayheadKey: InjectionKey<ArrangementPlayheadSource> =
  Symbol("arrangement-playhead")

export function clipContainsPlayhead(membership: string, clipId: string): boolean {
  if (membership.length === 0) return false
  return membership.split("\0").includes(clipId)
}
