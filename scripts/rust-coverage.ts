import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { delimiter, dirname, join } from "node:path"
import { rustTarget } from "./rust-target.ts"
import {
  WORKSPACE_ROOT,
  captureCommand,
  cargoExecutable,
  runCommand,
  runTask
} from "./task-process.ts"

type CoverageMode = "local" | "ci" | "native"
type CoverageStep = {
  command: "cargo" | "pnpm" | "mise" | "node"
  args: string[]
  instrumented: boolean
}

// show-env has no JSON output. Its PowerShell format encodes every character as
// a Unicode escape, so we can decode values without evaluating shell commands.
export function parseCoverageEnvironment(output: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const line of output.split(/\r?\n/u)) {
    if (!line) continue
    const match = /^\$env:([A-Z_][A-Z0-9_]*)="((?:`u\{[0-9a-fA-F]{1,6}\})*)"$/u.exec(line)
    if (!match?.[1] || match[2] === undefined) {
      throw new Error("Unsupported cargo llvm-cov show-env output")
    }
    const [, name, encoded] = match
    environment[name] = encoded.replace(/`u\{([0-9a-fA-F]+)\}/gu, (_, codepoint: string) =>
      String.fromCodePoint(Number.parseInt(codepoint, 16))
    )
  }
  if (environment.CARGO_LLVM_COV !== "1" || !environment.LLVM_PROFILE_FILE) {
    throw new Error("cargo llvm-cov did not provide the coverage environment")
  }
  return environment
}

export function coverageSteps(mode: CoverageMode, target: string): CoverageStep[] {
  const steps: CoverageStep[] = [
    { command: "cargo", args: ["llvm-cov", "clean", "--profraw-only"], instrumented: true },
    {
      command: "cargo",
      args: [
        "test",
        "--workspace",
        "--features",
        "heron-dsp-node/bench-internals",
        "--target",
        target
      ],
      instrumented: true
    },
    { command: "pnpm", args: ["--filter", "@heron/dsp-node", "build:debug"], instrumented: true }
  ]
  if (mode !== "native") {
    steps.push({ command: "pnpm", args: ["test:coverage:js"], instrumented: true })
  }
  steps.push({ command: "pnpm", args: ["test:native-bindings"], instrumented: true })
  if (mode === "ci") {
    steps.push(
      { command: "pnpm", args: ["test:scripts"], instrumented: true },
      { command: "mise", args: ["run", "test:official-plugin-fixtures"], instrumented: true }
    )
  }
  steps.push(
    {
      command: "cargo",
      args: [
        "llvm-cov",
        "report",
        "--target",
        target,
        "--ignore-filename-regex",
        "(/|^)third_party/",
        "--lcov",
        "--output-path",
        "coverage/rust/lcov.info"
      ],
      instrumented: true
    },
    {
      command: "node",
      args: ["scripts/rewrite-lcov-paths.ts", "coverage/rust/lcov.info"],
      instrumented: true
    }
  )
  if (mode === "native") {
    steps.push(
      { command: "pnpm", args: ["--filter", "@heron/desktop", "test:unit"], instrumented: false },
      {
        command: "pnpm",
        args: ["--filter", "@heron/project-db", "test:integration"],
        instrumented: false
      }
    )
  }
  return steps
}

export async function runCoverageSteps(
  mode: CoverageMode,
  target: string,
  baseEnvironment: NodeJS.ProcessEnv,
  coverageEnvironment: NodeJS.ProcessEnv,
  run = runCommand
): Promise<void> {
  for (const step of coverageSteps(mode, target)) {
    const command =
      step.command === "cargo"
        ? cargoExecutable(baseEnvironment)
        : step.command === "node"
          ? process.execPath
          : step.command
    await run(command, step.args, {
      env: step.instrumented ? coverageEnvironment : baseEnvironment
    })
  }
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2)
  if ((mode !== "local" && mode !== "ci" && mode !== "native") || rest.length > 0) {
    throw new Error("Usage: node scripts/rust-coverage.ts <local|ci|native>")
  }

  const baseEnvironment = { ...process.env }
  if (process.platform === "win32") {
    // Cargo needs the actual installed binary on PATH, not mise's shell shim.
    const llvmCov = (await captureCommand("mise", ["which", "cargo-llvm-cov"])).trim()
    const pathKey =
      Object.keys(baseEnvironment).find((key) => key.toUpperCase() === "PATH") ?? "PATH"
    baseEnvironment[pathKey] = `${dirname(llvmCov)}${delimiter}${baseEnvironment[pathKey] ?? ""}`
  }
  const cargo = cargoExecutable(baseEnvironment)
  const target = await rustTarget({ env: baseEnvironment })
  const coverageTarget = join(WORKSPACE_ROOT, "target-coverage")
  await mkdir(coverageTarget, { recursive: true })
  const cacheTag = join(coverageTarget, "CACHEDIR.TAG")
  if (!existsSync(cacheTag)) {
    await writeFile(
      cacheTag,
      "Signature: 8a477f597d28d172789f06886806bc55\n" +
        "# This file is a cache directory tag created for Cargo coverage artifacts.\n" +
        "# For information about cache directory tags see https://bford.info/cachedir/\n"
    )
  }
  const coverageEnvironment = { ...baseEnvironment, CARGO_TARGET_DIR: coverageTarget }
  Object.assign(
    coverageEnvironment,
    parseCoverageEnvironment(
      await captureCommand(cargo, ["llvm-cov", "show-env", "--pwsh", "--target", target], {
        env: coverageEnvironment
      })
    )
  )
  await mkdir(join(WORKSPACE_ROOT, "coverage", "rust"), { recursive: true })
  await runCoverageSteps(mode, target, baseEnvironment, coverageEnvironment)
}

if (import.meta.main) await runTask(main)
