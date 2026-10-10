import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { acquirePluginStageLock } from "./plugin-stage-lock.ts"

function notification(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

interface GateWorker {
  child: ChildProcess
  waiting: Promise<void>
  held: Promise<void>
  exited: Promise<unknown>
}

function gateWorker(path: string, onHeld: () => void): GateWorker {
  const waiting = notification()
  const held = notification()
  const helper = new URL("plugin-stage-lock.ts", import.meta.url).href
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import { acquirePluginStageLock } from ${JSON.stringify(helper)};
        let release;
        try {
          release = await acquirePluginStageLock(process.argv[1], 0);
        } catch (error) {
          if (!error.message.includes("staging is busy")) throw error;
          process.send({ event: "waiting" });
          release = await acquirePluginStageLock(process.argv[1]);
        }
        process.send({ event: "held" });
        process.once("message", async () => {
          await release();
          process.disconnect();
        });
      `,
      path
    ],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] }
  )
  const exited = once(child, "exit")
  const failed = exited.then(() => {
    throw new Error("Gate worker exited before the expected notification")
  })
  child.on("message", (value: unknown) => {
    const message = value as { event?: string }
    if (message.event === "waiting") waiting.resolve()
    if (message.event === "held") {
      waiting.resolve()
      onHeld()
      held.resolve()
    }
  })
  const waitingPromise = Promise.race([waiting.promise, failed])
  const heldPromise = Promise.race([held.promise, failed])
  // Cleanup may terminate a contender whose notification was never awaited.
  void waitingPromise.catch(() => undefined)
  void heldPromise.catch(() => undefined)
  return { child, waiting: waitingPromise, held: heldPromise, exited }
}

await test("release retains one gate inode and cannot unlock a subsequent publisher", async () => {
  const directory = await mkdtemp(join(tmpdir(), "heron-plugin-gate-"))
  const path = join(directory, "stage.gate")
  try {
    const release = await acquirePluginStageLock(path)
    const original = await stat(path)
    await assert.rejects(acquirePluginStageLock(path, 0), /staging is busy/u)
    await release()
    const nextRelease = await acquirePluginStageLock(path, 0)
    try {
      // Releasing an old scope must not unlock a descriptor reused by a new one.
      await release()
      await assert.rejects(acquirePluginStageLock(path, 0), /staging is busy/u)
      const current = await stat(path)
      assert.equal(current.dev, original.dev)
      assert.equal(current.ino, original.ino)
    } finally {
      await nextRelease()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

await test(
  "a crashed holder releases the gate and competing recovery callers cannot evict its successor",
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "heron-plugin-gate-crash-"))
    const path = join(directory, "stage.gate")
    const workers: GateWorker[] = []
    try {
      const holder = gateWorker(path, () => undefined)
      workers.push(holder)
      await holder.held
      const entered: GateWorker[] = []
      const first = gateWorker(path, () => entered.push(first))
      const second = gateWorker(path, () => entered.push(second))
      workers.push(first, second)
      await Promise.all([first.waiting, second.waiting])
      await assert.rejects(acquirePluginStageLock(path, 0), /staging is busy/u)
      // No graceful release or PID cleanup: this also covers interrupted stages.
      holder.child.kill("SIGKILL")
      await holder.exited
      await Promise.race([first.held, second.held])
      const winner = entered[0]
      assert(winner)
      const follower = winner === first ? second : first
      await assert.rejects(acquirePluginStageLock(path, 0), /staging is busy/u)
      assert.equal(entered.length, 1)
      winner.child.send("release")
      await winner.exited
      await follower.held
      await assert.rejects(acquirePluginStageLock(path, 0), /staging is busy/u)
      assert.equal(entered.length, 2)
      follower.child.send("release")
      await follower.exited
      const release = await acquirePluginStageLock(path, 0)
      await release()
    } finally {
      for (const worker of workers) {
        if (worker.child.exitCode === null && worker.child.signalCode === null)
          worker.child.kill("SIGKILL")
      }
      await Promise.all(workers.map((worker) => worker.exited))
      await rm(directory, { recursive: true, force: true })
    }
  }
)
