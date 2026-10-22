import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  HASH_COMMIT_SUBJECT,
  extractGotHash,
  planFodUpdates,
  readSourcesPin,
  updateSourcesPin
} from "./nix-fod-hash.ts"

const specified = "sha256-aIbp28dQ/v8HuRl0iI3UTt0lCDUe2xi4CATc1OlX+r8="
const got = "sha256-NLpX6HStCY+k83tauECX1+N5wOn0UIJ+zgO9PcVsZvw="
const decoySpecified = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
const decoyGot = "sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="

const multilineLog = `
error: hash mismatch in fixed-output derivation '/nix/store/zzz-other.drv':
         specified: ${decoySpecified}
            got:    ${decoyGot}
error: hash mismatch in fixed-output derivation '/nix/store/avmnw9k76ylddcsyv75xarrb9z231r42-heron-pnpm-deps.drv':
         specified: ${specified}
            got:    ${got}
##[error]To correct the hash mismatch for heron-pnpm-deps, use "${got}"
`

const oneLineLog = `hash mismatch in fixed-output derivation heron-pnpm-deps: specified ${specified} got ${got}`

const sources = `{
  # Upstream inputs only; Heron itself is always built from this checkout.
  pnpm = "${specified}";
  vst3sdk = {
    rev = "9fad9770f2ae8542ab1a548a68c1ad1ac690abe0";
    hash = "sha256-ZGhhFic8l8xDwajTJgZPXl6M+S3QhrDX5zrCSu/Vfvg=";
  };
  araSdk = {
    rev = "0005c532bb03eb210e7bb490329fc6d7ba1792c7";
    hash = "sha256-t4VTZQid9Uks4Y6TgKZOqGmG+Gce7N9d01+1UsMJ5ZY=";
  };
}
`

await test("reads the pnpm pin and ignores other hashes", () => {
  assert.equal(readSourcesPin(sources, "pnpm"), specified)
  assert.equal(readSourcesPin(readFileSync("nix/sources.nix", "utf8"), "pnpm"), specified)
  assert.equal(readSourcesPin(sources, "cargo"), null)
  assert.equal(readSourcesPin(sources, "hash"), null)
})

await test("extracts the got hash for the named derivation and current pin", () => {
  assert.equal(extractGotHash(multilineLog, "heron-pnpm-deps", specified), got)
  assert.equal(extractGotHash(oneLineLog, "heron-pnpm-deps", specified), got)
  assert.equal(extractGotHash(multilineLog, "heron-pnpm-deps", decoySpecified), null)
  assert.equal(extractGotHash(multilineLog, "other", specified), null)
  assert.equal(extractGotHash(multilineLog, "deps", specified), null)
  assert.equal(extractGotHash(multilineLog, "heron-pnpm-deps", got), null)
  assert.equal(extractGotHash("build failed: missing network", "heron-pnpm-deps", specified), null)
})

await test("replaces only the requested pin", () => {
  const next = updateSourcesPin(sources, "pnpm", got)
  assert.equal(readSourcesPin(next, "pnpm"), got)
  assert.match(next, /vst3sdk = \{/)
  assert.match(next, /sha256-ZGhhFic8l8xDwajTJgZPXl6M\+S3QhrDX5zrCSu\/Vfvg=/)
  assert.match(next, /sha256-t4VTZQid9Uks4Y6TgKZOqGmG\+Gce7N9d01\+1UsMJ5ZY=/)
  assert.throws(() => updateSourcesPin(sources, "pnpm", "sha256-short"), /invalid SRI hash/)
  assert.throws(() => updateSourcesPin(sources, "cargo", got), /pin cargo was not found/)
  assert.throws(() => updateSourcesPin(sources, "pnpm; evil", got), /invalid sources pin name/)
})

await test("plans pnpm updates and skips cargo unless a pin exists", () => {
  const pnpmOnly = planFodUpdates(["pnpm-lock.yaml"], sources)
  assert.deepEqual(pnpmOnly.updates, [
    { key: "pnpm", derivation: "heron-pnpm-deps", attribute: ".#heron.pnpmDeps" }
  ])
  assert.deepEqual(pnpmOnly.notes, [])

  const cargoOnly = planFodUpdates(
    ["Cargo.lock", ".agents/skills/rust-skills/checks/Cargo.lock"],
    sources
  )
  assert.deepEqual(cargoOnly.updates, [])
  assert.equal(cargoOnly.notes.length, 1)
  assert.match(cargoOnly.notes[0] ?? "", /no cargo fixed-output pin/)

  const withCargoPin = sources.replace("pnpm = ", `cargo = "${decoySpecified}";\n  pnpm = `)
  const both = planFodUpdates(["pnpm-lock.yaml", "Cargo.lock"], withCargoPin)
  assert.deepEqual(
    both.updates.map((update) => update.key),
    ["pnpm", "cargo"]
  )
  assert.equal(both.updates[1]?.derivation, "vendor-staging")
  assert.equal(both.updates[1]?.attribute, ".#heron.cargoDeps")
  assert.equal(
    extractGotHash(
      `error: hash mismatch in fixed-output derivation '/nix/store/abcdefghijklmnopqrstuvwxyz234567-heron-0.9.0-vendor-staging.drv':\n         specified: ${decoySpecified}\n            got:    ${decoyGot}\n`,
      "vendor-staging",
      decoySpecified
    ),
    decoyGot
  )
})

await test("apply writes the got hash and reports a missing mismatch", () => {
  const directory = mkdtempSync(join(tmpdir(), "nix-fod-"))
  const sourcesPath = join(directory, "sources.nix")
  const logPath = join(directory, "build.log")
  writeFileSync(sourcesPath, sources)
  writeFileSync(logPath, multilineLog)
  const updated = spawnSync(
    process.execPath,
    [
      "scripts/nix-fod-hash.ts",
      "apply",
      "--sources",
      sourcesPath,
      "--key",
      "pnpm",
      "--derivation",
      "heron-pnpm-deps",
      "--log",
      logPath
    ],
    { encoding: "utf8" }
  )
  assert.equal(updated.status, 0, updated.stderr)
  assert.equal(updated.stdout.trim(), `updated pnpm ${got}`)
  assert.equal(readSourcesPin(readFileSync(sourcesPath, "utf8"), "pnpm"), got)

  writeFileSync(logPath, "error: builder failed")
  const missing = spawnSync(
    process.execPath,
    [
      "scripts/nix-fod-hash.ts",
      "apply",
      "--sources",
      sourcesPath,
      "--key",
      "pnpm",
      "--derivation",
      "heron-pnpm-deps",
      "--log",
      logPath
    ],
    { encoding: "utf8" }
  )
  assert.equal(missing.status, 2)
  assert.equal(readSourcesPin(readFileSync(sourcesPath, "utf8"), "pnpm"), got)
})

await test("the workflow skips its own hash commit subject", () => {
  const workflow = readFileSync(".github/workflows/update-nix-hashes.yml", "utf8")
  assert.equal(workflow.includes(HASH_COMMIT_SUBJECT), true)
  const subject = spawnSync(process.execPath, ["scripts/nix-fod-hash.ts", "subject"], {
    encoding: "utf8"
  })
  assert.equal(subject.status, 0)
  assert.equal(subject.stdout.trim(), HASH_COMMIT_SUBJECT)
})
