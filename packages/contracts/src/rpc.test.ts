import { describe, expect, it } from "vitest"

import {
  IPC_PROTOCOL_VERSION,
  isResourceRef,
  isRpcRequestMeta,
  rpcFailure,
  rpcSuccess
} from "./rpc"
import type { RpcError, RpcRequestMeta } from "./rpc"

const desktop = {
  kind: "desktop-session",
  id: "desktop",
  epoch: "18446744073709551615",
  generation: 3
} as const

const mutationMeta: RpcRequestMeta = {
  protocolVersion: IPC_PROTOCOL_VERSION,
  requestId: "request-7",
  target: desktop,
  expectedRevision: 11,
  mutation: {
    operationId: "operation-9",
    idempotencyKey: "open:C:/music/demo.heron"
  }
}

describe("IPC v2 contracts", () => {
  it("requires string epochs rather than potentially lossy numeric epochs", () => {
    expect(isResourceRef(desktop)).toBe(true)
    expect(isResourceRef({ ...desktop, epoch: Number(desktop.epoch) })).toBe(false)
  })

  it("rejects malformed, stale-shaped, and unknown-version metadata", () => {
    expect(isRpcRequestMeta(mutationMeta)).toBe(true)
    expect(isRpcRequestMeta({ ...mutationMeta, protocolVersion: 1 })).toBe(false)
    expect(isRpcRequestMeta({ ...mutationMeta, target: { ...desktop, epoch: 9 } })).toBe(false)
    expect(
      isRpcRequestMeta({
        ...mutationMeta,
        mutation: { operationId: "", idempotencyKey: "key" }
      })
    ).toBe(false)
  })

  it("constructs success and failure envelopes with request and operation identity", () => {
    expect(rpcSuccess(mutationMeta, { projectId: "project-1" })).toEqual({
      ok: true,
      requestId: "request-7",
      operationId: "operation-9",
      value: { projectId: "project-1" },
      warnings: []
    })

    const error: RpcError = {
      code: "revision-conflict",
      category: "conflict",
      outcome: "not-committed",
      retry: "after-reconcile",
      correlationId: "correlation-2",
      userMessageKey: "errors.revisionConflict",
      resource: desktop,
      details: {
        type: "revision-conflict",
        expectedRevision: 11,
        actualRevision: 12
      }
    }
    const failure = rpcFailure(mutationMeta, error)
    expect(failure).toEqual({
      ok: false,
      requestId: "request-7",
      operationId: "operation-9",
      error
    })
  })
})
