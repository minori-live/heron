import { readFileSync, writeFileSync } from "node:fs"

/** Subject of the follow-up commit. The workflow skip condition must use this exact text. */
export const HASH_COMMIT_SUBJECT = "chore(nix): update fixed-output hashes"

const SRI_SHA256 = /^sha256-[A-Za-z0-9+/]{43}=$/u

export interface FodUpdate {
  key: string
  derivation: string
  attribute: string
}

export interface FodPlan {
  updates: FodUpdate[]
  notes: string[]
}

const PNPM_UPDATE: FodUpdate = {
  key: "pnpm",
  derivation: "heron-pnpm-deps",
  attribute: ".#heron.pnpmDeps"
}

const CARGO_UPDATE: FodUpdate = {
  key: "cargo",
  derivation: "vendor-staging",
  attribute: ".#heron.cargoDeps"
}

function pinPattern(key: string): RegExp {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) throw new Error(`invalid sources pin name: ${key}`)
  // Top-level nix/sources.nix pins are indented two spaces. Nested `hash`
  // attributes must not match a lookup for a different pin name.
  return new RegExp(`^(  ${key} = ")(sha256-[A-Za-z0-9+/]{43}=)(";)$`, "mu")
}

function namesDerivation(block: string, derivationName: string): boolean {
  const escaped = derivationName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  // The store path's output name is the full component after the 32-character
  // hash. A shorter suffix such as "deps" must not match "heron-pnpm-deps".
  if (new RegExp(`/[0-9a-z]{32}-${escaped}\\.drv`, "u").test(block)) return true
  if (new RegExp(`(?:^|\\s)derivation ${escaped}:`, "u").test(block)) return true
  // fetchCargoVendor's fixed-output derivation is `${pname}-${version}-vendor-staging`.
  return (
    derivationName === "vendor-staging" &&
    /\/[0-9a-z]{32}-[A-Za-z0-9._+-]*-vendor-staging\.drv/u.test(block)
  )
}

export function readSourcesPin(sources: string, key: string): string | null {
  return pinPattern(key).exec(sources)?.[2] ?? null
}

export function updateSourcesPin(sources: string, key: string, hash: string): string {
  if (!SRI_SHA256.test(hash)) throw new Error(`invalid SRI hash: ${hash}`)
  const pattern = pinPattern(key)
  if (!pattern.test(sources)) throw new Error(`pin ${key} was not found in nix/sources.nix`)
  return sources.replace(pattern, `$1${hash}$3`)
}

/**
 * Nix prints a fixed-output mismatch across a few lines:
 *
 *   error: hash mismatch in fixed-output derivation '...-heron-pnpm-deps.drv':
 *            specified: sha256-...
 *               got:    sha256-...
 *
 * Older or wrapped logs may put `specified` and `got` on that same line.
 * The replacement is accepted only when this mismatch names the derivation
 * and the hash currently written in nix/sources.nix.
 */
export function extractGotHash(
  log: string,
  derivationName: string,
  specified: string
): string | null {
  if (derivationName.length === 0) throw new Error("derivation name is required")
  if (!SRI_SHA256.test(specified)) return null
  const lines = log.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    if (!line.includes("hash mismatch")) continue
    const block = [line]
    for (let next = index + 1; next < lines.length && block.length < 8; next += 1) {
      const following = lines[next] ?? ""
      if (following.includes("hash mismatch")) break
      block.push(following)
    }
    const text = block.join("\n")
    if (!namesDerivation(text, derivationName) || !text.includes(specified)) continue
    const got = /\bgot:?[ \t]+(sha256-[A-Za-z0-9+/]{43}=)/u.exec(text)
    if (got?.[1] && got[1] !== specified) return got[1]
  }
  return null
}

export function planFodUpdates(changedPaths: readonly string[], sources: string): FodPlan {
  const updates: FodUpdate[] = []
  const notes: string[] = []
  if (changedPaths.includes("pnpm-lock.yaml")) updates.push(PNPM_UPDATE)
  if (changedPaths.includes("Cargo.lock")) {
    if (readSourcesPin(sources, "cargo")) updates.push(CARGO_UPDATE)
    else {
      notes.push(
        "Cargo.lock changed and nix/sources.nix has no cargo fixed-output pin. cargoLock imports per-crate checksums, so there is no aggregate hash to update."
      )
    }
  }
  return { updates, notes }
}

function argumentValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function requireArgument(args: readonly string[], name: string): string {
  const value = argumentValue(args, name)
  if (!value || value.startsWith("--")) throw new Error(`missing ${name}`)
  return value
}

function planCommand(args: string[]): number {
  const separator = args.indexOf("--")
  const flags = separator === -1 ? args : args.slice(0, separator)
  const changed = separator === -1 ? [] : args.slice(separator + 1)
  const sources = readFileSync(requireArgument(flags, "--sources"), "utf8")
  const plan = planFodUpdates(changed, sources)
  for (const note of plan.notes) console.error(note)
  for (const update of plan.updates) {
    console.log(`${update.key}\t${update.derivation}\t${update.attribute}`)
  }
  return 0
}

function applyCommand(args: string[]): number {
  const sourcesPath = requireArgument(args, "--sources")
  const key = requireArgument(args, "--key")
  const derivation = requireArgument(args, "--derivation")
  const logPath = requireArgument(args, "--log")
  const sources = readFileSync(sourcesPath, "utf8")
  const specified = readSourcesPin(sources, key)
  if (!specified) throw new Error(`pin ${key} was not found in ${sourcesPath}`)
  const got = extractGotHash(readFileSync(logPath, "utf8"), derivation, specified)
  if (!got) return 2
  const next = updateSourcesPin(sources, key, got)
  if (next !== sources) writeFileSync(sourcesPath, next)
  console.log(`updated ${key} ${got}`)
  return 0
}

function main(argv: string[]): number {
  const [command, ...args] = argv
  try {
    if (command === "subject") {
      console.log(HASH_COMMIT_SUBJECT)
      return 0
    }
    if (command === "plan") return planCommand(args)
    if (command === "apply") return applyCommand(args)
    console.error("usage: nix-fod-hash.ts <plan|apply|subject>")
    return 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
