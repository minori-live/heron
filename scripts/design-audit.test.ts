import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

await test("design audit rejects domain palette overrides in product components", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "heron-design-audit-"))
  try {
    const renderer = join(workspace, "apps/desktop/src/renderer/src")
    const styles = join(workspace, "packages/ui/src/styles")
    await mkdir(renderer, { recursive: true })
    await mkdir(styles, { recursive: true })
    await mkdir(join(workspace, "apps/design-system/src"), { recursive: true })
    await writeFile(join(styles, "tokens.css"), ":root { --ui-daw-action: #8da8b5; }")
    await writeFile(join(styles, "domain-palette.css"), ":root { --ui-domain-meter: #00ff00; }")
    await writeFile(join(workspace, "package.json"), "{}")
    const component = join(renderer, "Meter.vue")
    const audit = () =>
      spawnSync(process.execPath, [join(import.meta.dirname, "design-audit.ts")], {
        cwd: workspace,
        encoding: "utf8"
      })

    await writeFile(component, "<style scoped>.meter { color: var(--ui-domain-meter); }</style>")
    const allowed = audit()
    assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr)

    await writeFile(
      component,
      "<style scoped>.meter { --ui-domain-meter: var(--ui-daw-action); }</style>"
    )
    const rejected = audit()
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr)
    assert.match(rejected.stdout + rejected.stderr, /forked-domain-palette: --ui-domain-meter/u)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
