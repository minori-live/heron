import type {
  MidiClipState,
  MixerChannelState,
  TrackFreezeMode,
  TrackFreezeState
} from "@heron/contracts"
import type { TimelineClip } from "../../stores/transport"

export type ArrangementTimelineTrack = MixerChannelState & {
  trackId: string
  sortOrder: number
  freezeMode?: TrackFreezeMode
  freeze?: TrackFreezeState | null
}

export interface ArrangementTrackRow {
  track: ArrangementTimelineTrack
  audioClips: TimelineClip[]
  midiClips: MidiClipState[]
  scale: number
  height: number
}
