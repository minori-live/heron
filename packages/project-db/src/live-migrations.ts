import { fileURLToPath } from "node:url"
import type { PgliteDatabase } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as liveSchema from "./live-schema.ts"

export const LIVE_MIGRATIONS_FOLDER = fileURLToPath(
  new URL(/* @vite-ignore */ "../drizzle-live", import.meta.url)
)

export function migrateLiveDatabase(
  db: PgliteDatabase<typeof liveSchema>,
  migrationsFolder = LIVE_MIGRATIONS_FOLDER
): Promise<void> {
  return migrate(db, { migrationsFolder })
}
