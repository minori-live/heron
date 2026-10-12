import type { UiCascadingSelectGroup } from "@heron/ui"
import type { MixerBusState, MixerChannelCoreState, MixerRouteTarget } from "@heron/contracts"

export type MixerRouteGroupsTranslator = (key: string, params?: Record<string, unknown>) => string

export function targetValue(target: MixerRouteTarget): string {
  const format = target.format ?? (target.kind === "bus" ? "mono" : "stereo")
  return `${format}:${target.kind === "bus" ? `bus:${target.bus}` : `output:${target.channelId}`}`
}

export function parseTarget(value: string): MixerRouteTarget {
  const separator = value.indexOf(":")
  const format = value.slice(0, separator) as "mono" | "stereo"
  const route = value.slice(separator + 1)
  return route.startsWith("output:")
    ? { kind: "output", channelId: route.slice(7), format }
    : { kind: "bus", bus: Number(route.slice(4)), format }
}

export function mixerRouteGroups(
  targets: readonly MixerRouteTarget[],
  buses: readonly MixerBusState[],
  outputs: readonly MixerChannelCoreState[],
  t: MixerRouteGroupsTranslator
): readonly UiCascadingSelectGroup[] {
  return (["mono", "stereo"] as const).map((format) => ({
    label: t(`mixer.routeGroups.${format}`),
    options: targets
      .filter((target) => (target.format ?? (target.kind === "bus" ? "mono" : "stereo")) === format)
      .map((target) => ({
        value: targetValue(target),
        label:
          target.kind === "bus"
            ? format === "stereo"
              ? `BUS ${target.bus}–${target.bus + 1}`
              : (buses.find((bus) => bus.channel === target.bus)?.name ?? `BUS ${target.bus}`)
            : (outputs.find((output) => output.id === target.channelId)?.name ??
              t("mixer.routeGroups.missingOutput"))
      }))
  }))
}
