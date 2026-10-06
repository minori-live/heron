import type { fitEq, EqFitResult } from "../../lib/eq-fit"

export type EqFitInput = Parameters<typeof fitEq>[0]
export type EqFitSuccess = Extract<EqFitResult, { ok: true }>
export type EqFitError = Extract<EqFitResult, { ok: false }>["code"] | "worker-failed"
