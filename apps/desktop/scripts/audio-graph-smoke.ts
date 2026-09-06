import { IPC_PROTOCOL_VERSION } from "@heron/contracts/rpc"
import type { GraphTransactionValue } from "../src/main/audio-host/wire"

/** Exercise the same graph transaction boundary used by the desktop. */
export async function publishSmokeGraph(
  send: (command: Record<string, unknown>) => Promise<unknown>,
  runtimeEpoch: string,
  revision: number,
  graph: unknown
): Promise<void> {
  const meta = {
    protocolVersion: IPC_PROTOCOL_VERSION,
    requestId: `smoke-graph-${revision}`,
    target: { kind: "audio-engine", id: "engine", epoch: runtimeEpoch, generation: 1 }
  }
  const transaction = async (command: Record<string, unknown>): Promise<GraphTransactionValue> => {
    const response = (await send(command)) as {
      type: string
      result?: { ok: boolean; value: GraphTransactionValue; error?: { userMessageKey: string } }
    }
    if (response.type !== "graph-transaction" || !response.result?.ok) {
      throw new Error(response.result?.error?.userMessageKey ?? "graph transaction failed")
    }
    return response.result.value
  }
  const snapshot = await transaction({ type: "graph-deployment-snapshot", meta })
  const baseRevision = snapshot.snapshot.committedRevision
  const mutationMeta = {
    ...meta,
    expectedRevision: baseRevision,
    mutation: { operationId: meta.requestId, idempotencyKey: meta.requestId }
  }
  const request = {
    helperEpoch: runtimeEpoch,
    projectGraph: { kind: "project-graph", id: "smoke", epoch: "smoke-project", generation: 1 },
    baseRevision
  }
  await transaction({
    type: "prepare-graph",
    meta: mutationMeta,
    request: { ...request, graphRevision: revision, graph }
  })
  const activated = await transaction({ type: "activate-graph", meta: mutationMeta, request })
  if (activated.type !== "activated" || activated.snapshot.committedRevision !== revision) {
    throw new Error("graph activation did not commit the requested revision")
  }
}
