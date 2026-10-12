import type { MixerInputFormat } from "@heron/contracts"

export function busRouteContains(
  bus: number,
  format: MixerInputFormat | null | undefined,
  inputs: readonly number[]
): boolean {
  return inputs.includes(bus) || (format === "stereo" && inputs.includes(bus + 1))
}

export function routeFormat(
  format: MixerInputFormat | null | undefined,
  bus: number | null | undefined
): MixerInputFormat {
  return format ?? (bus == null ? "stereo" : "mono")
}
