import type { Results } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { PGlite } from "@electric-sql/pglite"

export interface DatabaseMaintenanceExecutor {
  execute(query: SQL): PromiseLike<Results<Record<string, unknown>>>
}

export async function listLargeObjectOids(
  executor: DatabaseMaintenanceExecutor
): Promise<number[]> {
  const result = await executor.execute(
    sql`select oid from pg_catalog.pg_largeobject_metadata order by oid`
  )
  return result.rows.map((row) => Number(row.oid)).filter((oid) => Number.isInteger(oid) && oid > 0)
}

export async function vacuumAndAnalyze(executor: DatabaseMaintenanceExecutor): Promise<void> {
  // VACUUM cannot run inside a transaction. Keep this as a separate save-time
  // maintenance step after orphan cleanup has committed.
  await executor.execute(sql`vacuum (analyze)`)
}

/** Archive header checks run before Drizzle migrations touch an existing archive. */
export async function inspectStudioArchive(client: PGlite): Promise<{
  exists: boolean
  kind?: string
  formatVersion?: number
}> {
  const table = await client.query<{ name: string | null }>(
    "select to_regclass('public.project')::text as name"
  )
  if (!table.rows[0]?.name) return { exists: false }
  const columns = await client.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'project' and column_name in ('kind', 'format_version')"
  )
  const names = new Set(columns.rows.map((row) => row.column_name))
  const [kind, version] = await Promise.all([
    names.has("kind")
      ? client.query<{ kind: string }>("select kind from project where id = 'project'")
      : null,
    names.has("format_version")
      ? client.query<{ format_version: number }>(
          "select format_version from project where id = 'project'"
        )
      : null
  ])
  return {
    exists: true,
    ...(kind ? { kind: kind.rows[0]?.kind } : {}),
    ...(version ? { formatVersion: version.rows[0]?.format_version } : {})
  }
}

export async function inspectLiveArchive(client: PGlite): Promise<{
  exists: boolean
  kind?: string
  formatVersion?: number
}> {
  const table = await client.query<{ name: string | null }>(
    "select to_regclass('public.live_document')::text as name"
  )
  if (!table.rows[0]?.name) return { exists: false }
  const rows = await client.query<{ kind: string; format_version: number }>(
    "select kind, format_version from live_document where id = 'document'"
  )
  return {
    exists: true,
    kind: rows.rows[0]?.kind,
    formatVersion: rows.rows[0]?.format_version
  }
}

export async function clearLiveMixer(executor: DatabaseMaintenanceExecutor): Promise<void> {
  await executor.execute(sql`truncate table
    live_plugin_parameter_values, live_midi_bindings,
    plugin_sidechain_routes, plugin_state_chunks, plugin_instances,
    mixer_sends, mixer_channels`)
}
