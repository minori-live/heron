import { execFileSync } from "node:child_process"
import path from "node:path"

const harnessDirectory = ".agents/skills/rust-skills/checks"

export function assertStandaloneHarness(workspaceRoot: string, repoRoot: string): void {
  const expected = path.resolve(repoRoot, harnessDirectory)
  const actual = path.resolve(workspaceRoot)
  if (actual !== expected) {
    throw new Error(
      `rust-skills harness workspace is ${actual}, expected ${expected}. Exclude ${harnessDirectory} from the root Cargo workspace.`
    )
  }
}

function cargoMetadata(repoRoot: string): { workspace_root?: string } {
  try {
    const raw = execFileSync(
      "cargo",
      [
        "metadata",
        "--manifest-path",
        path.join(harnessDirectory, "Cargo.toml"),
        "--no-deps",
        "--format-version",
        "1",
        "--offline"
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    )
    return JSON.parse(raw) as { workspace_root?: string }
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error ? String(error.stderr) : ""
    if (stderr) console.error(stderr)
    throw error
  }
}

if (import.meta.main) {
  const repoRoot = process.cwd()
  const metadata = cargoMetadata(repoRoot)
  if (!metadata.workspace_root) throw new Error("cargo metadata did not report workspace_root")
  assertStandaloneHarness(metadata.workspace_root, repoRoot)
}
