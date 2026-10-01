import type {
  LiveCaptureField,
  LiveCaptureStateTarget,
  LiveLayerId,
  LivePerformanceCommand,
  LiveRuntimeSnapshot
} from "@heron/contracts"
import { applyLiveCapture, applyLivePerformanceCommand } from "./live"
import {
  applyLiveLayerEdit,
  liveFieldDefiningLayer,
  resolveLiveLayer,
  validateLiveHierarchy,
  type LiveLayerDocument
} from "./live-layers"

/** Scalars retain their owners; opaque state writes to an explicitly chosen permitted layer. */
export function applyLiveLayerCapture(
  document: LiveLayerDocument,
  layerId: LiveLayerId,
  frozen: LiveRuntimeSnapshot,
  available: readonly LiveCaptureField[],
  selected: readonly LiveCaptureField[],
  stateTargets: readonly LiveCaptureStateTarget[] = []
): LiveLayerDocument {
  if (layerId !== null && !document.hierarchy.patches.some((patch) => patch.id === layerId)) {
    throw new TypeError("Capture requires Project or a Patch")
  }
  const destinations = stateDestinations(document, layerId, selected, stateTargets)
  const effective = resolveLiveLayer(document.snapshot, document.hierarchy, layerId)
  // This checks duplicate/unavailable selection and validates every selected frozen value.
  const captured = applyLiveCapture(effective, frozen, available, selected)
  let next = structuredClone(document)
  for (const field of selected) {
    if (field.type === "plugin-state") {
      const target = destinations.get(field.id)!
      if (target === null) {
        next.snapshot = applyLiveCapture(next.snapshot, captured, [field], [field])
      } else {
        next = applyLiveLayerEdit(next, {
          type: "set-live-plugin-state",
          layerId: target,
          pluginId: field.id,
          state: captured.graph.plugins.find((plugin) => plugin.id === field.id)!.state
        })
      }
      continue
    }
    const override = commandForField(captured, field)
    const owner = liveFieldDefiningLayer(document.hierarchy, layerId, field)
    if (owner === null) {
      next.snapshot = applyLivePerformanceCommand(next.snapshot, override)
    } else {
      next = applyLiveLayerEdit(next, {
        type: "set-live-override",
        layerId: owner,
        override
      })
    }
  }
  validateLiveHierarchy(next.snapshot, next.hierarchy)
  return next
}

function stateDestinations(
  document: LiveLayerDocument,
  layerId: LiveLayerId,
  selected: readonly LiveCaptureField[],
  targets: readonly LiveCaptureStateTarget[]
): Map<string, LiveLayerId> {
  const wireTargets: unknown = targets
  if (!Array.isArray(wireTargets)) throw new TypeError("Invalid Live state Capture destinations")
  const states = selected.filter((field) => field.type === "plugin-state")
  const destinations = new Map<string, LiveLayerId>()
  for (const target of targets) {
    if (
      !target ||
      typeof target !== "object" ||
      !states.some((field) => field.id === target.pluginId) ||
      destinations.has(target.pluginId) ||
      (target.layerId !== null && (typeof target.layerId !== "string" || !target.layerId.trim())) ||
      Object.keys(target).some((key) => key !== "pluginId" && key !== "layerId")
    ) {
      throw new TypeError("Invalid Live state Capture destination")
    }
    destinations.set(target.pluginId, target.layerId)
  }
  for (const field of states) {
    if (!destinations.has(field.id)) {
      if (layerId !== null) throw new TypeError("Choose a destination for complete plug-in state")
      destinations.set(field.id, null)
    }
    const owner = liveFieldDefiningLayer(document.hierarchy, layerId, field)
    const destination = destinations.get(field.id)
    if (destination !== owner && destination !== layerId) {
      throw new TypeError("Capture state into its defining layer or the active Patch")
    }
  }
  return destinations
}

function commandForField(
  snapshot: LiveRuntimeSnapshot,
  field: Exclude<LiveCaptureField, { type: "plugin-state" }>
): LivePerformanceCommand {
  switch (field.type) {
    case "channel":
      return {
        ...field,
        value: snapshot.graph.channels.find((channel) => channel.id === field.id)![field.parameter]
      }
    case "send":
      return {
        ...field,
        value: snapshot.graph.sends.find((send) => send.id === field.id)![field.parameter]
      }
    case "plugin":
      return {
        ...field,
        value: snapshot.graph.plugins.find((plugin) => plugin.id === field.id)!.enabled
      }
    case "plugin-parameter":
      return {
        ...field,
        value: snapshot.parameterValues.find(
          (value) => value.pluginId === field.id && value.parameterKey === field.parameterKey
        )!.value
      }
  }
}
