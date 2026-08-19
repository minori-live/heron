import type { ProjectAssetSummary } from "@heron/contracts"

export const PROJECT_MEDIA_DRAG_TYPE = "application/x-heron-project-media"

export interface ProjectMediaDragPayload {
  assetId: string
  kind: ProjectAssetSummary["kind"]
}

export function serializeProjectMediaDrag(asset: ProjectAssetSummary): string {
  return JSON.stringify({ assetId: asset.id, kind: asset.kind } satisfies ProjectMediaDragPayload)
}

export function parseProjectMediaDrag(value: string): ProjectMediaDragPayload | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<ProjectMediaDragPayload>
    return typeof parsed.assetId === "string" && (parsed.kind === "audio" || parsed.kind === "midi")
      ? { assetId: parsed.assetId, kind: parsed.kind }
      : null
  } catch {
    return null
  }
}
