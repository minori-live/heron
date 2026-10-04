import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureCommand } from "./diagnostics/live-mixer.ts"

await test("diagnostic runner preserves failed-command output and exit status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "heron-diagnostic-runner-"))
  try {
    const result = await captureCommand({
      directory,
      executable: process.execPath,
      args: [
        "-e",
        "console.log('sample stdout'); console.error('sample stderr'); process.exitCode = 7"
      ],
      tee: false
    })
    assert.deepEqual(result, { exitCode: 7, timedOut: false })
    const output = await readFile(join(directory, "output.log"), "utf8")
    assert.match(output, /sample stdout/u)
    assert.match(output, /sample stderr/u)
    const invocation = JSON.parse(await readFile(join(directory, "invocation.json"), "utf8"))
    assert.equal(invocation.state, "finished")
    assert.equal(invocation.exitCode, 7)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

await test("diagnostic runner retains a terminal record when a command cannot start", async () => {
  const directory = await mkdtemp(join(tmpdir(), "heron-diagnostic-runner-"))
  try {
    const result = await captureCommand({
      directory,
      executable: join(directory, "missing-command.exe"),
      args: [],
      tee: false
    })
    assert.notEqual(result.exitCode, 0)
    const invocation = JSON.parse(await readFile(join(directory, "invocation.json"), "utf8"))
    assert.equal(invocation.state, "finished")
    assert.equal(invocation.spawnError, "ENOENT")
    assert.equal(await readFile(join(directory, "output.log"), "utf8"), "")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

await test("diagnostic runner preserves evidence when its process deadline expires", async () => {
  const directory = await mkdtemp(join(tmpdir(), "heron-diagnostic-runner-"))
  try {
    const result = await captureCommand({
      directory,
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 1_000,
      tee: false
    })
    assert.deepEqual(result, { exitCode: 124, timedOut: true })
    const invocation = JSON.parse(await readFile(join(directory, "invocation.json"), "utf8"))
    assert.equal(invocation.state, "finished")
    assert.equal(invocation.timedOut, true)
    assert.match(await readFile(join(directory, "output.log"), "utf8"), /process deadline reached/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
