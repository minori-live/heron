import { spawn } from "node:child_process"
import { resolve } from "node:path"

export const WORKSPACE_ROOT = resolve(import.meta.dirname, "..")

export interface TaskProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export class TaskProcessFailure extends Error {
  readonly status: number | null
  readonly signal: NodeJS.Signals | null

  constructor(command: string, status: number | null, signal: NodeJS.Signals | null) {
    super(`${command} exited with ${signal ?? status ?? "unknown status"}`)
    this.status = status
    this.signal = signal
  }
}

export function cargoExecutable(env: NodeJS.ProcessEnv = process.env): string {
  return env.CARGO ?? (process.platform === "win32" ? "cargo.exe" : "cargo")
}

async function executeCommand(
  command: string,
  args: readonly string[],
  capture: boolean,
  options: TaskProcessOptions
): Promise<string> {
  if (!capture) console.error(`> ${command} ${args.join(" ")}`)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? WORKSPACE_ROOT,
      env: options.env ?? process.env,
      stdio: ["inherit", capture ? "pipe" : "inherit", "inherit"]
    })
    const chunks: string[] = []
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => chunks.push(chunk))
    let requestedSignal: NodeJS.Signals | null = null
    const interrupt = () => {
      requestedSignal ??= "SIGINT"
      child.kill("SIGINT")
    }
    const terminate = () => {
      requestedSignal ??= "SIGTERM"
      child.kill("SIGTERM")
    }
    process.on("SIGINT", interrupt)
    process.on("SIGTERM", terminate)
    const cleanup = () => {
      process.off("SIGINT", interrupt)
      process.off("SIGTERM", terminate)
    }
    child.once("error", (error) => {
      cleanup()
      reject(error)
    })
    child.once("close", (status, signal) => {
      cleanup()
      if (requestedSignal) reject(new TaskProcessFailure(command, status, requestedSignal))
      else if (status === 0 && signal === null) resolve(chunks.join(""))
      else reject(new TaskProcessFailure(command, status, signal))
    })
  })
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: TaskProcessOptions = {}
): Promise<void> {
  await executeCommand(command, args, false, options)
}

export async function captureCommand(
  command: string,
  args: readonly string[],
  options: TaskProcessOptions = {}
): Promise<string> {
  return executeCommand(command, args, true, options)
}

export async function runTask(main: () => Promise<void>): Promise<void> {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    if (error instanceof TaskProcessFailure && error.signal) {
      process.kill(process.pid, error.signal)
    } else {
      process.exitCode = error instanceof TaskProcessFailure ? (error.status ?? 1) : 1
    }
  }
}
