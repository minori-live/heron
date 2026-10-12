import { captureCommand, runTask, type TaskProcessOptions } from "./task-process.ts"

export function parseRustTarget(output: string): string {
  const target = output.match(/^host:[\t ]*(\S+)[\t ]*\r?$/mu)?.[1]
  if (!target) throw new Error("Could not determine the Rust host target from rustc -vV")
  return target
}

export async function rustTarget(options: TaskProcessOptions = {}): Promise<string> {
  return parseRustTarget(await captureCommand("rustc", ["-vV"], options))
}

if (import.meta.main) {
  await runTask(async () => {
    console.log(await rustTarget())
  })
}
