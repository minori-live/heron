import type { LiveCaptureField, LivePerformCommand, LivePerformanceCommand } from "@heron/contracts"

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function id(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function generation(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isCaptureField(value: unknown): value is LiveCaptureField {
  if (!record(value) || !id(value.id)) return false
  switch (value.type) {
    case "channel":
      return (
        typeof value.parameter === "string" &&
        ["gainDb", "pan", "muted", "soloed"].includes(value.parameter)
      )
    case "send":
      return value.parameter === "levelDb" || value.parameter === "enabled"
    case "plugin":
      return value.parameter === "enabled"
    case "plugin-parameter":
      return id(value.parameterKey)
    case "plugin-state":
      return true
    default:
      return false
  }
}

function isAdjustment(value: unknown): value is LivePerformanceCommand {
  if (!record(value)) return false
  const adjustment = value.value
  if (!isCaptureField(value) || value.type === "plugin-state") return false
  const numeric =
    value.type === "plugin-parameter" ||
    (value.type === "channel" && (value.parameter === "gainDb" || value.parameter === "pan")) ||
    (value.type === "send" && value.parameter === "levelDb")
  return numeric
    ? typeof adjustment === "number" && Number.isFinite(adjustment)
    : typeof adjustment === "boolean"
}

/** Validate wire shape before commands enter the serialized performance controller. */
export function isLivePerformCommand(value: unknown): value is LivePerformCommand {
  if (!record(value)) return false
  switch (value.type) {
    case "enter":
      return true
    case "activate":
      return (
        generation(value.generation) &&
        (value.layerId === null || id(value.layerId)) &&
        (value.disposition === "discard" || value.disposition === "cancel")
      )
    case "leave":
      return (
        generation(value.generation) &&
        (value.disposition === "discard" || value.disposition === "cancel")
      )
    case "adjust":
      return generation(value.generation) && isAdjustment(value.command)
    case "capture":
      return (
        id(value.captureId) &&
        Array.isArray(value.fields) &&
        value.fields.every(isCaptureField) &&
        (value.stateTargets === undefined ||
          (Array.isArray(value.stateTargets) &&
            value.stateTargets.every(
              (target) =>
                record(target) &&
                id(target.pluginId) &&
                (target.layerId === null || id(target.layerId)) &&
                Object.keys(target).every((key) => key === "pluginId" || key === "layerId")
            )))
      )
    default:
      return false
  }
}
