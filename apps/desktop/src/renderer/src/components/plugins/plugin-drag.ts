import type { PluginDescriptor } from "@heron/contracts"

export const PLUGIN_DRAG_TYPE = "application/x-heron-plugin"

export type PluginDragPayload =
  | { source: "catalog"; descriptor: PluginDescriptor }
  | { source: "rack"; instanceId: string }

type PluginDropPreviewOwner = () => void

let activePluginDropPreview: PluginDropPreviewOwner | null = null

export function claimPluginDropPreview(owner: PluginDropPreviewOwner): void {
  if (activePluginDropPreview === owner) return
  const previousOwner = activePluginDropPreview
  activePluginDropPreview = owner
  previousOwner?.()
}

export function releasePluginDropPreview(owner: PluginDropPreviewOwner): void {
  if (activePluginDropPreview === owner) activePluginDropPreview = null
}

export function clearActivePluginDropPreview(): void {
  const owner = activePluginDropPreview
  activePluginDropPreview = null
  owner?.()
}

export function serializePluginDrag(payload: PluginDragPayload): string {
  return JSON.stringify(payload)
}

export function parsePluginDrag(value: string): PluginDragPayload | null {
  if (!value) return null
  try {
    const payload = JSON.parse(value) as Partial<PluginDragPayload>
    if (payload.source === "rack" && typeof payload.instanceId === "string") {
      return { source: "rack", instanceId: payload.instanceId }
    }
    if (
      payload.source === "catalog" &&
      typeof payload.descriptor === "object" &&
      payload.descriptor !== null
    ) {
      return { source: "catalog", descriptor: payload.descriptor }
    }
  } catch {
    // Untrusted native drag data is ignored.
  }
  return null
}
