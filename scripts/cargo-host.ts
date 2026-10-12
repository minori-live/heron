import { rustTarget } from "./rust-target.ts"
import { cargoExecutable, runCommand, runTask, type TaskProcessOptions } from "./task-process.ts"

export function cargoHostArguments(args: readonly string[], target: string): string[] {
  const separator = args.indexOf("--")
  const cargoEnd = separator === -1 ? args.length : separator
  const cargoArgs = args.slice(0, cargoEnd)
  if (cargoArgs.some((arg) => arg === "--target" || arg.startsWith("--target="))) return [...args]
  return [...cargoArgs, "--target", target, ...args.slice(cargoEnd)]
}

export async function cargoHost(
  args: readonly string[],
  options: TaskProcessOptions = {}
): Promise<void> {
  if (!args.length) throw new Error("Usage: node scripts/cargo-host.ts <cargo command> [arguments]")
  await runCommand(
    cargoExecutable(options.env),
    cargoHostArguments(args, await rustTarget(options)),
    options
  )
}

if (import.meta.main) {
  await runTask(async () => cargoHost(process.argv.slice(2)))
}
