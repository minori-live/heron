import { eq, sql } from "drizzle-orm"
import { midiEvents, midiNotes } from "../schema"
import type { ProjectTransaction } from "./database-types"

/** Arithmetic expressions stay within Drizzle updates and the caller's transaction. */
export async function rebaseMidiClipContent(
  tx: ProjectTransaction,
  clipId: string,
  deltaTicks: number
): Promise<void> {
  await tx
    .update(midiNotes)
    .set({ startTick: sql`${midiNotes.startTick} + ${deltaTicks}` })
    .where(eq(midiNotes.clipId, clipId))
  await tx
    .update(midiEvents)
    .set({ tick: sql`${midiEvents.tick} + ${deltaTicks}` })
    .where(eq(midiEvents.clipId, clipId))
}
