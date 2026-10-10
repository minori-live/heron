import { parseArgs } from "node:util"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parsePluginLock, stablePluginVersion } from "./plugin-artifact-contract.ts"
import {
  updatePluginLock,
  updatePluginLockToLatest,
  type ReleaseFetch
} from "./plugin-release-lock.ts"

const { values, positionals } = parseArgs({
  options: {
    latest: { type: "boolean", default: false },
    "pending-lock": { type: "string" }
  },
  allowPositionals: true
})
try {
  if (
    (values.latest && positionals.length !== 0) ||
    (!values.latest && (positionals.length !== 1 || !positionals[0]))
  )
    throw new Error(
      "Usage: pnpm plugins:update <stable-version> | --latest [--pending-lock <path>]"
    )
  const pending = values["pending-lock"]
    ? parsePluginLock(JSON.parse(await readFile(values["pending-lock"], "utf8")))
    : undefined
  const fetchRelease: ReleaseFetch = (url) => {
    const token = process.env.GH_TOKEN
    return fetch(url, {
      signal: AbortSignal.timeout(120_000),
      headers:
        url.startsWith("https://api.github.com/") && token
          ? { Authorization: `Bearer ${token}` }
          : undefined
    })
  }
  const workspace = resolve(import.meta.dirname, "..")
  const changed = values.latest
    ? await updatePluginLockToLatest(workspace, fetchRelease, pending)
    : await updatePluginLock(workspace, stablePluginVersion(positionals[0]), fetchRelease, pending)
  console.log(
    changed ? "Locked the published Heron plug-in release" : "Plug-in lock is already current"
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
