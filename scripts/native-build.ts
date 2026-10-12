import { copyFile, mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { rustTarget } from "./rust-target.ts"
import {
  cargoExecutable,
  runCommand,
  runTask,
  WORKSPACE_ROOT,
  type TaskProcessOptions
} from "./task-process.ts"

type BuildProfile = "debug" | "release"
type CommandRunner = typeof runCommand

interface NativeBuildOptions {
  profile: BuildProfile
  target: string
  workspace?: string
  env?: NodeJS.ProcessEnv
}

const PROBES = [
  { package: "heron-vst3-host", binary: "heron-vst3-probe" },
  { package: "heron-clap-host", binary: "heron-clap-probe" }
] as const

function nativeArtifactPath(options: NativeBuildOptions, probe: (typeof PROBES)[number]) {
  const workspace = options.workspace ?? WORKSPACE_ROOT
  const targetDirectory = resolve(
    workspace,
    (options.env ?? process.env).CARGO_TARGET_DIR ?? "target"
  )
  const executable = `${probe.binary}${options.target.includes("-windows-") ? ".exe" : ""}`
  return {
    packageName: probe.package,
    binary: probe.binary,
    source: join(targetDirectory, options.target, options.profile, executable),
    staged: join(workspace, "target", options.profile, executable)
  }
}

export function nativeArtifactPaths(options: NativeBuildOptions) {
  return PROBES.map((probe) => nativeArtifactPath(options, probe))
}

export async function nativeBuild(
  options: NativeBuildOptions,
  run: CommandRunner = runCommand
): Promise<void> {
  const workspace = options.workspace ?? WORKSPACE_ROOT
  const processOptions: TaskProcessOptions = { cwd: workspace, env: options.env }
  const artifacts = nativeArtifactPaths(options)
  for (const artifact of artifacts) {
    await run(
      cargoExecutable(options.env),
      [
        "build",
        "--target",
        options.target,
        ...(options.profile === "release" ? ["--release"] : []),
        "-p",
        artifact.packageName,
        "--bin",
        artifact.binary
      ],
      processOptions
    )
  }
  await mkdir(join(workspace, "target", options.profile), { recursive: true })
  for (const artifact of artifacts) await copyFile(artifact.source, artifact.staged)
}

export async function nativeUniversalMacos(
  options: Omit<NativeBuildOptions, "target">,
  run: CommandRunner = runCommand
): Promise<void> {
  const arm64 = { ...options, target: "aarch64-apple-darwin" }
  const x64 = { ...options, target: "x86_64-apple-darwin" }
  await nativeBuild(arm64, run)
  await nativeBuild(x64, run)
  for (const probe of PROBES) {
    const arm64Artifact = nativeArtifactPath(arm64, probe)
    const x64Artifact = nativeArtifactPath(x64, probe)
    await run(
      "lipo",
      ["-create", arm64Artifact.source, x64Artifact.source, "-output", arm64Artifact.staged],
      {
        cwd: options.workspace ?? WORKSPACE_ROOT,
        env: options.env
      }
    )
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: "string", default: "debug" },
      target: { type: "string" }
    }
  })
  if (values.profile !== "debug" && values.profile !== "release") {
    throw new Error("Native build profile must be debug or release")
  }
  if (positionals.length !== 1) throw new Error("Expected native build or universal-macos command")
  if (positionals[0] === "build") {
    await nativeBuild({ profile: values.profile, target: values.target ?? (await rustTarget()) })
  } else if (positionals[0] === "universal-macos" && values.target === undefined) {
    await nativeUniversalMacos({ profile: values.profile })
  } else {
    throw new Error("Expected build [--target <triple>] or universal-macos")
  }
}

if (import.meta.main) await runTask(main)
