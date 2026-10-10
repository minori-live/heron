import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { stageSentrySymbols } from "./sentry-symbol-files.ts"
import { preparePluginArtifacts } from "../../../scripts/plugin-artifact-cache.ts"

const appDirectory = fileURLToPath(new URL("..", import.meta.url))
const workspace = resolve(appDirectory, "../..")
const destination = join(workspace, "release/sentry-symbols")
const require = createRequire(import.meta.url)
const { version } = require("../package.json") as { version: string }

function sentry(args: string[]): void {
  const result = spawnSync(
    process.execPath,
    [require.resolve("@sentry/cli/bin/sentry-cli"), ...args],
    {
      cwd: appDirectory,
      env: process.env,
      stdio: "inherit"
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`sentry-cli exited with status ${result.status}`)
}

// Preserve the matching per-architecture dSYM/PDB/ELF files before CI discards
// the target tree. Avoid collecting dependency libraries and intermediate rlibs.
const pluginSymbols = await preparePluginArtifacts({ workspace, symbols: true })
await stageSentrySymbols(
  join(workspace, "target"),
  join(appDirectory, "out/main"),
  destination,
  pluginSymbols
)

if (!process.argv.includes("--stage-only")) {
  const credentials = [
    process.env.SENTRY_AUTH_TOKEN,
    process.env.SENTRY_ORG,
    process.env.SENTRY_PROJECT
  ]
  if (credentials.every((value) => !value)) {
    console.warn("Sentry upload is unconfigured; matching symbols are retained in the CI artifact.")
  } else if (credentials.some((value) => !value)) {
    throw new Error(
      "Sentry uploads require SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT together"
    )
  } else {
    sentry(["debug-files", "upload", "--include-sources", "--wait", join(destination, "native")])
    sentry([
      "sourcemaps",
      "upload",
      "--release",
      `heron@${version}`,
      "--validate",
      join(destination, "main")
    ])
  }
}
