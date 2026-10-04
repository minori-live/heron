import type { PluginStateEnvelope } from "@heron/contracts"

/** Opaque payloads retain their binary representation at every Live document boundary. */
export function validateLivePluginState(state: PluginStateEnvelope): void {
  if (
    !state ||
    typeof state !== "object" ||
    state.version !== 1 ||
    !Array.isArray(state.chunks) ||
    Object.keys(state).some((key) => key !== "version" && key !== "chunks")
  ) {
    throw new TypeError("Invalid Live plug-in state envelope")
  }
  const keys = new Set<string>()
  for (const chunk of state.chunks) {
    if (
      !chunk ||
      typeof chunk !== "object" ||
      typeof chunk.key !== "string" ||
      !chunk.key.trim() ||
      keys.has(chunk.key) ||
      !(chunk.bytes instanceof Uint8Array) ||
      Object.keys(chunk).some((key) => key !== "key" && key !== "bytes")
    ) {
      throw new TypeError("Invalid Live plug-in state chunk")
    }
    keys.add(chunk.key)
  }
}
