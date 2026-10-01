import type {
  LiveEditCommand,
  LiveHierarchy,
  LiveLayerField,
  LiveLayerId,
  LiveMidiBinding,
  LiveMixerEditCommand,
  LivePerformanceCommand,
  LiveRuntimeSnapshot,
  LiveSet
} from "@heron/contracts"
import { applyLiveEdit, applyLivePerformanceCommand, captureFieldKey } from "./live"
import { validateMixerGraph } from "./mixer-validation"
import { validateLivePluginState } from "./live-plugin-state"

export interface LiveLayerDocument {
  snapshot: LiveRuntimeSnapshot
  bindings: LiveMidiBinding[]
  hierarchy: LiveHierarchy
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`)
}

function fieldKey(field: LiveLayerField): string {
  if (!field || typeof field !== "object") throw new TypeError("Invalid Live override field")
  requireText(field.id, "Override target")
  switch (field.type) {
    case "channel":
      if (!["gainDb", "pan", "muted", "soloed"].includes(field.parameter))
        throw new TypeError("Channel field cannot be overridden")
      break
    case "send":
      if (!["levelDb", "enabled"].includes(field.parameter))
        throw new TypeError("Send field cannot be overridden")
      break
    case "plugin":
      if (field.parameter !== "enabled") throw new TypeError("Plug-in field cannot be overridden")
      break
    case "plugin-parameter":
      requireText(field.parameterKey, "Plug-in parameter key")
      break
    case "plugin-state":
      break
    default:
      throw new TypeError("Unsupported Live override field")
  }
  return captureFieldKey(field)
}

function validateOverride(command: LivePerformanceCommand): void {
  if ((command as LiveLayerField).type === "plugin-state") {
    throw new TypeError("Opaque state requires a Live plug-in state override")
  }
  fieldKey(command)
  const numeric =
    command.type === "plugin-parameter" ||
    (command.type === "channel" && ["gainDb", "pan"].includes(command.parameter)) ||
    (command.type === "send" && command.parameter === "levelDb")
  if (
    numeric
      ? typeof command.value !== "number" || !Number.isFinite(command.value)
      : typeof command.value !== "boolean"
  ) {
    throw new TypeError("Live override has an invalid value")
  }
  const allowed = new Set([
    "type",
    "id",
    command.type === "plugin-parameter" ? "parameterKey" : "parameter",
    "value"
  ])
  if (Object.keys(command).some((key) => !allowed.has(key))) {
    throw new TypeError("Live override contains unsupported fields")
  }
}

function layerChain(hierarchy: LiveHierarchy, layerId: LiveLayerId): LiveSet[] {
  if (layerId === null) return []
  requireText(layerId, "Layer ID")
  const set = hierarchy.sets.find((candidate) => candidate.id === layerId)
  if (set) return [set]
  const patch = hierarchy.patches.find((candidate) => candidate.id === layerId)
  const parent = patch && hierarchy.sets.find((candidate) => candidate.id === patch.setId)
  if (!patch || !parent) throw new TypeError("Live layer is unavailable")
  return [parent, patch]
}

function resolveUnchecked(
  snapshot: LiveRuntimeSnapshot,
  hierarchy: LiveHierarchy,
  layerId: LiveLayerId
): LiveRuntimeSnapshot {
  let resolved = structuredClone(snapshot)
  for (const layer of layerChain(hierarchy, layerId)) {
    for (const override of layer.pluginStates ?? []) {
      const plugin = resolved.graph.plugins.find((plugin) => plugin.id === override.pluginId)
      if (!plugin) throw new TypeError("Live plug-in state target is unavailable")
      plugin.state = structuredClone(override.state)
    }
    for (const override of layer.overrides) {
      resolved = applyLivePerformanceCommand(resolved, override)
    }
  }
  return resolved
}

/** Every layer resolves from the durable Project, never from a previous selection. */
export function resolveLiveLayer(
  snapshot: LiveRuntimeSnapshot,
  hierarchy: LiveHierarchy,
  layerId: LiveLayerId
): LiveRuntimeSnapshot {
  validateLiveHierarchy(snapshot, hierarchy)
  return resolveUnchecked(snapshot, hierarchy, layerId)
}

export function liveFieldDefiningLayer(
  hierarchy: LiveHierarchy,
  layerId: LiveLayerId,
  field: LiveLayerField
): LiveLayerId {
  const key = fieldKey(field)
  return (
    layerChain(hierarchy, layerId).findLast((layer) =>
      field.type === "plugin-state"
        ? layer.pluginStates?.some((override) => override.pluginId === field.id)
        : layer.overrides.some((override) => fieldKey(override) === key)
    )?.id ?? null
  )
}

/** Validate every selectable layer so a Project edit cannot leave a hidden broken Patch. */
export function validateLiveHierarchy(
  snapshot: LiveRuntimeSnapshot,
  hierarchy: LiveHierarchy
): void {
  try {
    validateMixerGraph(snapshot.graph)
    if (!hierarchy || !Array.isArray(hierarchy.sets) || !Array.isArray(hierarchy.patches))
      throw new TypeError("Invalid Live hierarchy")
    if (Object.keys(hierarchy).some((key) => key !== "sets" && key !== "patches"))
      throw new TypeError("Live hierarchy contains unsupported fields")
    const pluginIds = new Set(snapshot.graph.plugins.map((plugin) => plugin.id))
    for (const plugin of snapshot.graph.plugins) validateLivePluginState(plugin.state)
    const parameterKeys = new Set<string>()
    for (const value of snapshot.parameterValues) {
      requireText(value.parameterKey, "Plug-in parameter key")
      const key = JSON.stringify([value.pluginId, value.parameterKey])
      if (!pluginIds.has(value.pluginId) || !Number.isFinite(value.value) || parameterKeys.has(key))
        throw new TypeError("Invalid Project plug-in parameter value")
      parameterKeys.add(key)
    }
    const layerIds = new Set<string>()
    const positions = new Set<string>()
    const setIds = new Set(hierarchy.sets.map((set) => set.id))
    for (const layer of [...hierarchy.sets, ...hierarchy.patches]) {
      requireText(layer.id, "Layer ID")
      requireText(layer.name, "Layer name")
      if (layerIds.has(layer.id)) throw new TypeError("Live layer IDs must be unique")
      layerIds.add(layer.id)
      if (!Number.isSafeInteger(layer.sortOrder) || layer.sortOrder < 0)
        throw new TypeError("Invalid Live layer order")
      const isPatch = hierarchy.patches.includes(layer as (typeof hierarchy.patches)[number])
      const allowedFields = new Set([
        "id",
        "name",
        "sortOrder",
        "overrides",
        "pluginStates",
        ...(isPatch ? ["setId"] : [])
      ])
      if (Object.keys(layer).some((key) => !allowedFields.has(key)))
        throw new TypeError("Live layer contains unsupported fields")
      const parent = isPatch ? (layer as (typeof hierarchy.patches)[number]).setId : null
      if (parent !== null && (typeof parent !== "string" || !setIds.has(parent)))
        throw new TypeError("Patch Set is unavailable")
      const position = JSON.stringify([parent, layer.sortOrder])
      if (positions.has(position)) throw new TypeError("Live sibling order must be unique")
      positions.add(position)
      if (!Array.isArray(layer.overrides)) throw new TypeError("Invalid Live overrides")
      const fields = new Set<string>()
      for (const override of layer.overrides) {
        validateOverride(override)
        const key = fieldKey(override)
        if (fields.has(key)) throw new TypeError("A layer can override each field only once")
        fields.add(key)
      }
      if (layer.pluginStates !== undefined) {
        if (!Array.isArray(layer.pluginStates)) throw new TypeError("Invalid Live plug-in states")
        const stateIds = new Set<string>()
        for (const override of layer.pluginStates) {
          if (
            !override ||
            typeof override !== "object" ||
            !pluginIds.has(override.pluginId) ||
            stateIds.has(override.pluginId) ||
            Object.keys(override).some((key) => key !== "pluginId" && key !== "state")
          ) {
            throw new TypeError("Invalid Live plug-in state override")
          }
          stateIds.add(override.pluginId)
          validateLivePluginState(override.state)
        }
      }
    }
    for (const layer of [...hierarchy.sets, ...hierarchy.patches]) {
      resolveUnchecked(snapshot, hierarchy, layer.id)
    }
  } catch (error) {
    if (error instanceof TypeError) throw error
    throw new TypeError(error instanceof Error ? error.message : "Invalid Live hierarchy", {
      cause: error
    })
  }
}

function requireLayer(hierarchy: LiveHierarchy, id: string): LiveSet {
  return layerChain(hierarchy, id).at(-1)!
}

function nextOrder(layers: readonly LiveSet[]): number {
  return Math.max(-1, ...layers.map((layer) => layer.sortOrder)) + 1
}

function putOverride(layer: LiveSet, override: LivePerformanceCommand): void {
  validateOverride(override)
  const key = fieldKey(override)
  const index = layer.overrides.findIndex((value) => fieldKey(value) === key)
  if (index < 0) layer.overrides.push(structuredClone(override))
  else layer.overrides[index] = structuredClone(override)
}

function scalarEdits(command: LiveMixerEditCommand): LivePerformanceCommand[] {
  const allowed =
    command.type === "update-channel"
      ? ["gainDb", "pan", "muted", "soloed"]
      : command.type === "update-send"
        ? ["levelDb", "enabled"]
        : command.type === "update-plugin"
          ? ["enabled"]
          : []
  if (
    !("patch" in command) ||
    !allowed.length ||
    !command.patch ||
    typeof command.patch !== "object"
  )
    throw new TypeError("Edit structure and routing at the Project layer")
  const fields: [string, unknown][] = Object.entries(command.patch)
  return fields.map(([parameter, value]) => {
    if (!allowed.includes(parameter))
      throw new TypeError("Edit structure and routing at the Project layer")
    const type =
      command.type === "update-channel"
        ? "channel"
        : command.type === "update-send"
          ? "send"
          : "plugin"
    const id =
      "channelId" in command
        ? command.channelId
        : "sendId" in command
          ? command.sendId
          : command.pluginId
    const override = { type, id, parameter, value } as LivePerformanceCommand
    validateOverride(override)
    return override
  })
}

function applyRootEdit(next: LiveLayerDocument, command: LiveMixerEditCommand): void {
  if (command.type === "replace-plugin") {
    const affected = [...next.hierarchy.sets, ...next.hierarchy.patches].some(
      (layer) =>
        layer.overrides.some(
          (value) =>
            (value.type === "plugin" || value.type === "plugin-parameter") &&
            value.id === command.pluginId
        ) || layer.pluginStates?.some((state) => state.pluginId === command.pluginId)
    )
    if (affected) throw new TypeError("Revert dependent overrides before replacing this plug-in")
  }
  const edited = applyLiveEdit({ graph: next.snapshot.graph, bindings: next.bindings }, command)
  const pluginIds = new Set(edited.graph.plugins.map((plugin) => plugin.id))
  next.snapshot.graph = edited.graph
  next.bindings = edited.bindings
  next.snapshot.parameterValues = next.snapshot.parameterValues.filter(
    (value) =>
      pluginIds.has(value.pluginId) &&
      !(command.type === "replace-plugin" && value.pluginId === command.pluginId)
  )
}

/** Pure document transaction. Validation failure never mutates the source document. */
export function applyLiveLayerEdit(
  document: LiveLayerDocument,
  command: LiveEditCommand
): LiveLayerDocument {
  validateLiveHierarchy(document.snapshot, document.hierarchy)
  const next = structuredClone(document)
  const hierarchy = next.hierarchy
  try {
    switch (command.type) {
      case "create-set":
        hierarchy.sets.push({
          id: command.setId,
          name: command.name.trim(),
          sortOrder: nextOrder(hierarchy.sets),
          overrides: []
        })
        break
      case "create-patch":
        hierarchy.patches.push({
          id: command.patchId,
          setId: command.setId,
          name: command.name.trim(),
          sortOrder: nextOrder(hierarchy.patches.filter((patch) => patch.setId === command.setId)),
          overrides: []
        })
        break
      case "rename-live-layer":
        requireLayer(hierarchy, command.layerId).name = command.name.trim()
        break
      case "delete-live-layer": {
        requireLayer(hierarchy, command.layerId)
        hierarchy.sets = hierarchy.sets.filter((set) => set.id !== command.layerId)
        hierarchy.patches = hierarchy.patches.filter(
          (patch) => patch.id !== command.layerId && patch.setId !== command.layerId
        )
        break
      }
      case "copy-live-set": {
        const source = hierarchy.sets.find((set) => set.id === command.sourceId)
        if (!source) throw new TypeError("Source Set is unavailable")
        const patches = hierarchy.patches.filter((patch) => patch.setId === source.id)
        if (
          !command.patchIds ||
          Object.keys(command.patchIds).length !== patches.length ||
          patches.some((patch) => !Object.hasOwn(command.patchIds, patch.id))
        )
          throw new TypeError("Set copy requires a new ID for every contained Patch")
        hierarchy.sets.push({
          ...structuredClone(source),
          id: command.setId,
          name: command.name.trim(),
          sortOrder: nextOrder(hierarchy.sets)
        })
        for (const patch of patches)
          hierarchy.patches.push({
            ...structuredClone(patch),
            id: command.patchIds[patch.id]!,
            setId: command.setId
          })
        break
      }
      case "copy-live-patch": {
        const source = hierarchy.patches.find((patch) => patch.id === command.sourceId)
        if (!source) throw new TypeError("Source Patch is unavailable")
        // Copy preserves explicit Patch overrides; inherited values come from the destination Set.
        hierarchy.patches.push({
          ...structuredClone(source),
          id: command.patchId,
          setId: command.setId,
          name: command.name.trim(),
          sortOrder: nextOrder(hierarchy.patches.filter((patch) => patch.setId === command.setId))
        })
        break
      }
      case "set-live-override":
        putOverride(requireLayer(hierarchy, command.layerId), command.override)
        break
      case "set-live-plugin-state": {
        const layer = requireLayer(hierarchy, command.layerId)
        validateLivePluginState(command.state)
        const states = (layer.pluginStates ??= [])
        const index = states.findIndex((state) => state.pluginId === command.pluginId)
        const override = { pluginId: command.pluginId, state: structuredClone(command.state) }
        if (index < 0) states.push(override)
        else states[index] = override
        break
      }
      case "revert-live-override": {
        const layer = requireLayer(hierarchy, command.layerId)
        const key = fieldKey(command.field)
        if (command.field.type === "plugin-state") {
          layer.pluginStates = layer.pluginStates?.filter(
            (state) => state.pluginId !== command.field.id
          )
          if (!layer.pluginStates?.length) delete layer.pluginStates
        } else {
          layer.overrides = layer.overrides.filter((override) => fieldKey(override) !== key)
        }
        break
      }
      case "edit-live-layer":
        requireLayer(hierarchy, command.layerId)
        for (const override of scalarEdits(command.command)) {
          const definingLayer = liveFieldDefiningLayer(hierarchy, command.layerId, override)
          if (definingLayer === null)
            next.snapshot = applyLivePerformanceCommand(next.snapshot, override)
          else putOverride(requireLayer(hierarchy, definingLayer), override)
        }
        break
      default:
        if (
          ![
            "create-channel",
            "update-channel",
            "delete-channel",
            "create-send",
            "update-send",
            "delete-send",
            "create-plugin",
            "insert-plugin",
            "update-plugin",
            "delete-plugin",
            "move-plugin",
            "replace-plugin",
            "set-midi-bindings"
          ].includes(command.type)
        )
          throw new TypeError("Unsupported Live edit")
        applyRootEdit(next, command)
    }
    validateLiveHierarchy(next.snapshot, hierarchy)
    return next
  } catch (error) {
    if (error instanceof TypeError) throw error
    throw new TypeError(error instanceof Error ? error.message : "Invalid Live edit", {
      cause: error
    })
  }
}
