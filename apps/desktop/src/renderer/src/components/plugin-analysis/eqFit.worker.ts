import { fitEq, type EqFitResult } from "../../lib/eq-fit"
import type { EqFitInput } from "./eqFitWorkerTypes"

// The optimizer owns no audio or renderer resources. Terminating this disposable
// worker is cancellation even while the synchronous numerical search is running.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<EqFitInput>) => void) | null
  postMessage: (result: EqFitResult) => void
}
scope.onmessage = (event) => scope.postMessage(fitEq(event.data))
