import type { MixerGraphSnapshot } from "@heron/contracts"
import type { AudioHostGraph } from "./wire"

export class AudioHostSessionCoordinator {
  graph: {
    revision: number
    project: MixerGraphSnapshot
    runtime: AudioHostGraph
  } | null = null
  published: { revision: number; runtime: AudioHostGraph } | null = null
}
