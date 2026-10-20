import type { AudioHostGraph } from "./graph"

export interface AudioHostTrackFreezeRequest {
  operation_id: string
  graph_revision: number
  graph: AudioHostGraph
  channel_id: string
  mode: "pre-fader" | "source-only"
  start_frame: number
  end_frame: number
  output_path: string
}

export interface AudioHostTrackFreezeStatus {
  operation_id: string
  state: "running" | "completed" | "failed" | "cancelled"
  phase: "preparing" | "rendering"
  completed_units: number
  total_units: number
  rendered_frames?: number | null
  tail_frames?: number | null
  latency_samples?: number | null
  tail_truncated: boolean
  error?: string | null
}
