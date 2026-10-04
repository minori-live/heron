// DO NOT MERGE: bounded Windows-hosted reproduction of the Live root Mixer timeout.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs"
import { availableParallelism, cpus, freemem, release, tmpdir, totalmem } from "node:os"
import { join, resolve } from "node:path"

const pnpm = process.platform === "win32" ? "pnpm.exe" : "pnpm"
const mise = process.platform === "win32" ? "mise.exe" : "mise"
const slowOpenMs = 8_000

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function captureCommand(options: {
  directory: string
  executable: string
  args: string[]
  environment?: NodeJS.ProcessEnv
  timeoutMs?: number
  tee?: boolean
  captureOutput?: boolean
}): Promise<{ exitCode: number; timedOut: boolean }> {
  mkdirSync(options.directory, { recursive: true })
  const startedAt = new Date().toISOString()
  const start = performance.now()
  const invocation = { startedAt, executable: options.executable, args: options.args }
  const statusPath = join(options.directory, "invocation.json")
  writeJson(statusPath, { ...invocation, state: "running" })
  const log = createWriteStream(join(options.directory, "output.log"))
  if (options.captureOutput === false) {
    log.write(
      "Native/compiler output is streamed to the GitHub job log. Root-test JSON and invocation status are stored separately.\n"
    )
  }
  let timedOut = false
  let spawnError: string | undefined
  let termination:
    | {
        treeExitCode?: number | null
        treeError?: string
        fallbackUsed?: boolean
        closeMissing?: boolean
      }
    | undefined
  const child = spawn(options.executable, options.args, {
    env: options.environment ?? process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk: Buffer) => {
      if (options.captureOutput !== false) log.write(chunk)
      if (options.tee !== false) process.stdout.write(chunk)
    })
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  let closeDeadline: ReturnType<typeof setTimeout> | undefined
  child.once("error", (error: NodeJS.ErrnoException) => {
    spawnError = error.code ?? "spawn-error"
  })
  const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (done) => {
      child.once("close", (code, signal) => {
        done({ code, signal })
      })
      if (options.timeoutMs !== undefined)
        timeout = setTimeout(() => {
          timedOut = true
          termination = {}
          writeJson(statusPath, {
            ...invocation,
            state: "timed-out-awaiting-termination",
            exitCode: 124
          })
          log.write(
            "\nDiagnostic process deadline reached; terminating this invocation's process tree.\n"
          )
          if (process.platform === "win32" && child.pid !== undefined) {
            const killed = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
              windowsHide: true,
              timeout: 10_000
            })
            termination.treeExitCode = killed.status
            if (killed.error !== undefined) {
              termination.treeError =
                "code" in killed.error && typeof killed.error.code === "string"
                  ? killed.error.code
                  : killed.error.name
            }
            if (killed.status !== 0) {
              termination.fallbackUsed = child.kill("SIGKILL")
            }
          } else {
            termination.fallbackUsed = child.kill("SIGKILL")
          }
          closeDeadline = setTimeout(() => {
            termination = { ...termination, closeMissing: true }
            child.stdout.destroy()
            child.stderr.destroy()
            child.unref()
            done({ code: null, signal: null })
          }, 5_000)
        }, options.timeoutMs)
    }
  )
  clearTimeout(timeout)
  clearTimeout(closeDeadline)
  await new Promise<void>((done) => {
    log.end(done)
  })
  const exitCode = timedOut ? 124 : (outcome.code ?? 1)
  writeJson(statusPath, {
    ...invocation,
    state: "finished",
    elapsedMs: Math.round(performance.now() - start),
    exitCode,
    signal: outcome.signal,
    timedOut,
    spawnError,
    termination
  })
  return { exitCode, timedOut }
}

function command(executable: string, args: string[]): string {
  const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true })
  return result.status === 0 ? result.stdout.trim() : "unavailable"
}

function packageVersion(name: string): string {
  const path = join("packages/project-db/node_modules", name, "package.json")
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version
}

function manifest(): object {
  const sources = [
    "pnpm-lock.yaml",
    "mise.lock",
    "packages/project-db/vitest.config.ts",
    "packages/project-db/src/live-node.ts",
    "packages/project-db/src/__tests__/live-database.test.ts",
    "packages/project-db/src/__tests__/diagnostics/live-root-mixer-profile.ts",
    "scripts/diagnostics/live-mixer.ts",
    ".mise/tasks/ci/check/native-coverage",
    ".github/workflows/test.yml"
  ]
  return {
    recordedAt: new Date().toISOString(),
    actualCheckout: command("git", ["rev-parse", "HEAD"]),
    parents: command("git", ["show", "-s", "--format=%P", "HEAD"]),
    workingTree: command("git", ["status", "--porcelain", "--untracked-files=no"]),
    prHead: process.env.HERON_LIVE_DIAGNOSTICS_HEAD_SHA ?? null,
    prBase: process.env.HERON_LIVE_DIAGNOSTICS_BASE_SHA ?? null,
    originalFailureCommit: "2cd1325f635114b813da23463d8fb4485527a1c3",
    github: Object.fromEntries(
      [
        "GITHUB_SHA",
        "GITHUB_WORKFLOW_SHA",
        "GITHUB_RUN_ID",
        "GITHUB_RUN_ATTEMPT",
        "GITHUB_JOB",
        "RUNNER_OS",
        "RUNNER_ARCH",
        "RUNNER_ENVIRONMENT",
        "ImageOS",
        "ImageVersion"
      ].map((name) => [name, process.env[name] ?? null])
    ),
    versions: {
      node: process.version,
      pnpm: command(pnpm, ["--version"]),
      rust: command("rustc", ["--version"]),
      vitest: packageVersion("vitest"),
      pglite: packageVersion("@electric-sql/pglite")
    },
    host: {
      platform: process.platform,
      release: release(),
      arch: process.arch,
      cpuModels: [...new Set(cpus().map((cpu) => cpu.model))],
      logicalCpus: cpus().length,
      availableParallelism: availableParallelism(),
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      tempDirectory: tmpdir()
    },
    sources: sources.map((path) => ({
      path,
      gitBlob: command("git", ["rev-parse", `HEAD:${path}`]),
      workingSha256: createHash("sha256").update(readFileSync(path)).digest("hex")
    })),
    bounds:
      "Serial invocations; existing 15s test timeout unchanged. Fresh processes retain OS file cache. Profiling adds overhead; phase-only samples provide a comparison."
  }
}

type Trace = {
  reason: string
  elapsedMs: number
  cpuMs: number
  sample?: string
  stages: Array<{ name: string; durationMs?: number; cpuMs?: number; status?: string }>
}

function readTraces(directory: string): Trace[] {
  return readdirSync(directory)
    .filter((name) => /^live-root-mixer-.*\.json$/u.test(name))
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as Trace)
}

function diagnosticEnvironment(
  directory: string,
  sample: string,
  profile: boolean
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: "true",
    HERON_TRACE_LIVE_ROOT_MIXER: "1",
    HERON_PROFILE_LIVE_ROOT_MIXER: profile ? "1" : "0",
    HERON_LIVE_ROOT_MIXER_TRACE_DIR: directory,
    HERON_LIVE_ROOT_MIXER_SAMPLE: sample
  }
}

async function main(): Promise<number> {
  const [mode, requestedCount, ...unexpected] = process.argv.slice(2)
  if (
    unexpected.length ||
    (mode !== "--baseline" && mode !== "--samples") ||
    (mode === "--baseline" && requestedCount !== undefined)
  ) {
    throw new Error("Usage: node scripts/diagnostics/live-mixer.ts --baseline | --samples <1..3>")
  }
  const artifactDirectory = process.env.HERON_LIVE_DIAGNOSTICS_DIR
  if (!artifactDirectory) throw new Error("HERON_LIVE_DIAGNOSTICS_DIR is required")
  const root = resolve(artifactDirectory)
  mkdirSync(root, { recursive: true })
  if (mode === "--baseline") {
    writeJson(join(root, "baseline-manifest.json"), manifest())
    const outcome = await captureCommand({
      directory: join(root, "baseline"),
      executable: mise,
      args: ["run", "ci:check:native-coverage"],
      // Compiler/cache diagnostics stay in the service's masked job log.
      captureOutput: false,
      environment: diagnosticEnvironment(join(root, "baseline"), "baseline", false)
    })
    return outcome.exitCode
  }
  const count = Number(requestedCount)
  if (!Number.isInteger(count) || count < 1 || count > 3)
    throw new Error("Samples must be between 1 and 3")
  writeJson(join(root, "samples-manifest.json"), {
    ...manifest(),
    requestedSamples: count,
    precedingChecksOutcome: process.env.PRECEDING_CHECKS_OUTCOME ?? null,
    processDeadlineMs: 300_000,
    stopAfterArchiveOpenMs: slowOpenMs
  })
  const baselineDirectory = join(root, "baseline")
  if (existsSync(baselineDirectory)) {
    const baseline = readTraces(baselineDirectory)
    if (
      baseline.some((trace) =>
        trace.stages.some(
          (stage) =>
            stage.name === "open archive and migrate" && (stage.durationMs ?? 0) >= slowOpenMs
        )
      )
    ) {
      writeJson(join(root, "samples-summary.json"), {
        samples: [],
        stopReason: "slow-baseline-already-captured"
      })
      return 0
    }
    if (
      process.env.PRECEDING_CHECKS_OUTCOME === "success" &&
      (baseline.length !== 1 || baseline[0]?.reason !== "test passed")
    ) {
      writeJson(join(root, "samples-summary.json"), {
        samples: [],
        stopReason: "baseline-trace-missing-or-failed"
      })
      return 1
    }
  }
  const samples: object[] = []
  for (let index = 1; index <= count; index++) {
    const name = `sample-${index}`
    const directory = join(root, name)
    const profile = index % 2 === 1
    const result = await captureCommand({
      directory,
      executable: pnpm,
      args: [
        "--filter",
        "@heron/project-db",
        "test:integration",
        "--no-cache",
        "--silent=false",
        "--reporter=default"
      ],
      environment: diagnosticEnvironment(directory, name, profile),
      timeoutMs: 300_000
    })
    const traces = readTraces(directory)
    const opens = traces.map((trace) =>
      trace.stages.find((stage) => stage.name === "open archive and migrate")
    )
    const slow = opens.some((stage) => (stage?.durationMs ?? 0) >= slowOpenMs)
    const complete = traces.length === 1 && traces[0]?.reason === "test passed"
    samples.push({ name, profile, ...result, traceCount: traces.length, complete, slow, traces })
    writeJson(join(root, "samples-summary.json"), {
      samples,
      stopReason:
        result.exitCode !== 0
          ? "command-failed"
          : !complete
            ? "missing-or-failed-trace"
            : slow
              ? "slow-open-captured"
              : index === count
                ? "bounded-samples-complete"
                : "running"
    })
    if (result.exitCode !== 0 || !complete) return result.exitCode || 1
    if (slow) break
  }
  return 0
}

if (import.meta.main) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Diagnostic runner failed")
    process.exitCode = 1
  }
}
