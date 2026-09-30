import { readdirSync, readFileSync } from "node:fs"
import { extname, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (![".ts", ".vue"].includes(extname(entry.name))) return []
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".d.ts")) return []
    return [path]
  })
}

/**
 * Test-support modules, which only `*.test.ts` files import.
 *
 * They install a stand-in preload bridge, so they name `window.heron` the same
 * way the suites the scan already skips do. Nothing shipped imports them.
 */
function isTestSupport(path: string, rendererRoot: string): boolean {
  return relative(rendererRoot, path).replaceAll("\\", "/").startsWith("test/")
}

describe("renderer native-call boundary", () => {
  const rendererRoot = import.meta.dirname
  const desktopSourceRoot = resolve(rendererRoot, "../..")

  it("allows window.heron only in Pinia stores", () => {
    const violations = sourceFiles(rendererRoot)
      .filter((path) => readFileSync(path, "utf8").includes("window.heron"))
      .filter((path) => !relative(rendererRoot, path).replaceAll("\\", "/").startsWith("stores/"))
      .filter((path) => !isTestSupport(path, rendererRoot))
      .map((path) => relative(rendererRoot, path))

    expect(violations).toEqual([])
  })

  it("keeps test-support modules out of shipped renderer code", () => {
    const violations = sourceFiles(rendererRoot)
      .filter((path) => !isTestSupport(path, rendererRoot))
      .filter((path) =>
        /["']\.\.?(\/\.\.)*\/test\/(?:ipc|setup)["']/u.test(readFileSync(path, "utf8"))
      )
      .map((path) => relative(rendererRoot, path))

    expect(violations).toEqual([])
  })

  it("keeps native audio host packages out of renderer and preload", () => {
    const roots = [rendererRoot, resolve(desktopSourceRoot, "preload")]
    const forbiddenPackages = ["@heron/dsp-node"]
    const violations = roots.flatMap(sourceFiles).flatMap((path) => {
      const source = readFileSync(path, "utf8")
      return forbiddenPackages
        .filter((packageName) => source.includes(packageName))
        .map((packageName) => ({ packageName, path: relative(desktopSourceRoot, path) }))
    })

    expect(violations).toEqual([])
  })
})
