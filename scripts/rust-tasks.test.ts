import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import test, { type TestContext } from "node:test"
import { cargoHostArguments } from "./cargo-host.ts"
import { nativeArtifactPaths, nativeBuild, nativeUniversalMacos } from "./native-build.ts"
import { parseRustTarget } from "./rust-target.ts"
import { cargoExecutable, TaskProcessFailure, type runCommand } from "./task-process.ts"

async function temporaryWorkspace(context: TestContext): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "heron-native-tasks-"))
  context.after(async () => rm(workspace, { recursive: true, force: true }))
  return workspace
}

await test("Cargo host targeting stays before the test or benchmark argument separator", () => {
  assert.deepEqual(
    cargoHostArguments(["bench", "--workspace", "--", "--baseline", "main"], "host-triple"),
    ["bench", "--workspace", "--target", "host-triple", "--", "--baseline", "main"]
  )
  assert.deepEqual(cargoHostArguments(["test", "--lib"], "host-triple"), [
    "test",
    "--lib",
    "--target",
    "host-triple"
  ])
  assert.deepEqual(cargoHostArguments(["test", "--", "--target=fixture"], "host-triple"), [
    "test",
    "--target",
    "host-triple",
    "--",
    "--target=fixture"
  ])
})

await test("Cargo host targeting respects an explicitly selected Cargo target", () => {
  for (const target of [["--target", "cross-triple"], ["--target=cross-triple"]]) {
    const args = ["test", ...target, "--", "filter"]
    assert.deepEqual(cargoHostArguments(args, "host-triple"), args)
  }
  assert.equal(cargoExecutable({ CARGO: "/custom toolchain/cargo" }), "/custom toolchain/cargo")
})

await test("Rust target parsing requires a populated host field", () => {
  assert.equal(
    parseRustTarget("rustc 1.98.0\r\nhost: x86_64-pc-windows-msvc\r\nrelease: 1.98.0\r\n"),
    "x86_64-pc-windows-msvc"
  )
  assert.throws(() => parseRustTarget("host:\nrelease: 1.98.0\n"))
})

await test("Native builds stage both probes only after successful target-specific builds", async (context) => {
  const workspace = await temporaryWorkspace(context)
  const options = {
    workspace,
    profile: "release" as const,
    target: "x86_64-pc-windows-msvc",
    env: { CARGO: "selected-cargo", CARGO_TARGET_DIR: "coverage-build" }
  }
  const artifacts = nativeArtifactPaths(options)
  const requests: string[][] = []
  const run: typeof runCommand = async (command, args, processOptions) => {
    assert.equal(command, "selected-cargo")
    assert.equal(processOptions?.cwd, workspace)
    assert.equal(processOptions?.env, options.env)
    requests.push([...args])
    const artifact = artifacts.find((item) => args.includes(item.binary))
    assert(artifact)
    assert(artifact.source.endsWith(`${artifact.binary}.exe`))
    assert.equal(
      artifact.source,
      join(workspace, "coverage-build", options.target, "release", `${artifact.binary}.exe`)
    )
    await mkdir(dirname(artifact.source), { recursive: true })
    await writeFile(artifact.source, artifact.binary)
  }
  await nativeBuild(options, run)
  assert.deepEqual(
    requests,
    artifacts.map(({ packageName, binary }) => [
      "build",
      "--target",
      options.target,
      "--release",
      "-p",
      packageName,
      "--bin",
      binary
    ])
  )
  for (const artifact of artifacts) {
    assert.equal(artifact.staged, join(workspace, "target", "release", `${artifact.binary}.exe`))
    assert.equal(await readFile(artifact.staged, "utf8"), artifact.binary)
  }

  let calls = 0
  const [firstArtifact] = artifacts
  assert(firstArtifact)
  await assert.rejects(
    nativeBuild(options, async () => {
      if (++calls === 2) throw new TaskProcessFailure("selected-cargo", 9, null)
      await writeFile(firstArtifact.source, "new uncommitted probe")
    }),
    TaskProcessFailure
  )
  assert.equal(await readFile(firstArtifact.staged, "utf8"), firstArtifact.binary)
})

await test("Universal builds merge both architectures into Electron's stable probe paths", async (context) => {
  const workspace = await temporaryWorkspace(context)
  const options = { workspace, profile: "debug" as const, env: {} }
  const merges: string[][] = []
  const run: typeof runCommand = async (command, args) => {
    if (command === "lipo") {
      merges.push([...args])
      const [create, arm64Path, x64Path, output, staged] = args
      assert.equal(create, "-create")
      assert.equal(output, "-output")
      assert(arm64Path && x64Path && staged)
      const arm64 = await readFile(arm64Path, "utf8")
      const x64 = await readFile(x64Path, "utf8")
      assert.equal(arm64, "aarch64-apple-darwin")
      assert.equal(x64, "x86_64-apple-darwin")
      await writeFile(staged, `${arm64}+${x64}`)
      return
    }
    const target = args[args.indexOf("--target") + 1]
    const binary = args[args.indexOf("--bin") + 1]
    assert(target && binary)
    assert(!args.includes("--release"))
    const file = join(workspace, "target", target, "debug", binary)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, target)
  }
  await nativeUniversalMacos(options, run)
  assert.equal(merges.length, 2)
  for (const artifact of nativeArtifactPaths({ ...options, target: "aarch64-apple-darwin" })) {
    assert.equal(
      await readFile(artifact.staged, "utf8"),
      "aarch64-apple-darwin+x86_64-apple-darwin"
    )
  }
})

const processModule = pathToFileURL(join(import.meta.dirname, "task-process.ts")).href
function taskWrapper(childSource: string, nextStep = ""): string {
  return `import { runCommand, runTask } from ${JSON.stringify(processModule)};
    await runTask(async () => {
      await runCommand(process.execPath, ["-e", ${JSON.stringify(childSource)}]);
      ${nextStep}
    });`
}

await test("Task entry points preserve a failed child command's exit status", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    taskWrapper("process.exit(7)")
  ])
  assert.equal(result.status, 7)
})

await test(
  "Task entry points preserve child termination signals",
  { skip: process.platform === "win32" },
  () => {
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      taskWrapper("process.kill(process.pid, 'SIGTERM')")
    ])
    assert.equal(result.signal, "SIGTERM")
  }
)

await test(
  "Cancelling a task stops subsequent steps even when its child shuts down successfully",
  { skip: process.platform === "win32", timeout: 10_000 },
  async (context) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        taskWrapper(
          `
    process.on('SIGTERM', () => process.exit(0));
    console.log('ready');
    setInterval(() => {}, 1000);
  `,
          "console.log('continued')"
        )
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    )
    context.after(() => child.kill("SIGKILL"))
    let output = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      output += chunk
    })
    const finished = new Promise<NodeJS.Signals | null>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (_status, signal) => resolve(signal))
    })
    child.stdout.once("data", () => child.kill("SIGTERM"))
    assert.equal(await finished, "SIGTERM")
    assert.doesNotMatch(output, /continued/u)
  }
)
