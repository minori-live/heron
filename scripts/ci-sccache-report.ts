import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync } from "node:fs"

interface SccacheStatistics {
  stats: {
    cache_hits: { counts: Record<string, number> }
    cache_misses: { counts: Record<string, number> }
    cache_writes: number
    cache_write_errors: number
    cache_read_errors: number
  }
}

export function summarizeSccache(statistics: SccacheStatistics, log: string, readOnly: boolean) {
  const stats = statistics.stats
  const hits = Object.values(stats.cache_hits.counts).reduce((sum, count) => sum + count, 0)
  const misses = Object.values(stats.cache_misses.counts).reduce((sum, count) => sum + count, 0)
  const hitRate = hits + misses === 0 ? "n/a" : `${((100 * hits) / (hits + misses)).toFixed(1)}%`
  // Service errors can contain authenticated URLs. Summarize known signatures;
  // never publish the raw log or any part of the runner's credentials.
  const signals = [
    [/\b429\b|rate[ -]?limit|too many requests/iu, "rate limiting"],
    [/\b40[13]\b|permission[ _-]?denied|unauthorized|forbidden/iu, "authorization failure"],
    [/\b409\b|already[ _-]?exists/iu, "cache entry conflict"],
    [/\b402\b|quota|storage limit/iu, "storage or billing limit"]
  ] as const
  const detected = signals.filter(([pattern]) => pattern.test(log)).map(([, label]) => label)
  const errors = stats.cache_write_errors + stats.cache_read_errors
  const summary = [
    "### Shared sccache (GHA)",
    "",
    `Mode: ${readOnly ? "READ_ONLY (main/release cache consumer)" : "READ_WRITE (shared cache producer)"}`,
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Cache hits | ${hits} |`,
    `| Cache misses | ${misses} |`,
    `| Hit rate | ${hitRate} |`,
    `| Cache writes | ${stats.cache_writes} |`,
    `| Cache write errors | ${stats.cache_write_errors} |`,
    `| Cache read errors | ${stats.cache_read_errors} |`,
    "",
    `Diagnostic signals: ${detected.join(", ") || "none detected"}.`,
    ""
  ].join("\n")
  return { summary, errors }
}

if (import.meta.main) {
  const result = spawnSync(
    process.env.SCCACHE_PATH ?? "sccache",
    ["--show-stats", "--stats-format=json"],
    {
      encoding: "utf8"
    }
  )
  if (result.error || result.status !== 0) {
    console.log("::warning::Unable to read sccache statistics; cache health is unknown.")
  } else {
    const logPath = process.env.SCCACHE_ERROR_LOG
    const log = logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
    const { summary, errors } = summarizeSccache(
      JSON.parse(result.stdout) as SccacheStatistics,
      log,
      process.env.SCCACHE_GHA_RW_MODE === "READ_ONLY"
    )
    console.log(summary)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
    if (errors > 0)
      console.log(`::warning::sccache reported ${errors} cache I/O errors. See the job summary.`)
  }
}
