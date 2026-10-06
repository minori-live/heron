import { createHash } from "node:crypto"
import { access, cp, readdir, readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { buildProjectTemplateArchive } from "@heron/project-db/template"
import { buildLiveTemplateArchive } from "@heron/project-db/live-template"
import { defineConfig } from "vite"
import type { Plugin } from "vite"
import { appVersionDefine } from "./build/app-version.ts"
import { nodeBuiltins } from "./build/node-builtins.ts"
import { releaseBuild } from "./src/shared/release-build.ts"

const migrationsDirectory = resolve(import.meta.dirname, "../../packages/project-db/drizzle")
const bundledMigrationsDirectory = resolve(import.meta.dirname, "out/drizzle")
const bundledProjectTemplate = resolve(import.meta.dirname, "out/project-template.pglite.gz")
const liveMigrationsDirectory = resolve(
  import.meta.dirname,
  "../../packages/project-db/drizzle-live"
)
const bundledLiveMigrationsDirectory = resolve(import.meta.dirname, "out/drizzle-live")
const bundledLiveTemplate = resolve(import.meta.dirname, "out/live-template.pglite.gz")

async function migrationFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort()
}

async function migrationDigest(directory: string, files: string[]): Promise<string> {
  const hash = createHash("sha256")
  for (const file of files) {
    hash.update(file.slice(directory.length))
    hash.update(await readFile(file))
  }
  return hash.digest("hex")
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}

let generatedTemplateDigest: string | null = null
let generatedLiveTemplateDigest: string | null = null

const projectMigrations: Plugin = {
  name: "heron-project-migrations",
  async buildStart() {
    this.addWatchFile(migrationsDirectory)
    this.addWatchFile(liveMigrationsDirectory)
    for (const file of await migrationFiles(migrationsDirectory)) this.addWatchFile(file)
    for (const file of await migrationFiles(liveMigrationsDirectory)) this.addWatchFile(file)
  },
  async writeBundle() {
    const files = await migrationFiles(migrationsDirectory)
    const digest = await migrationDigest(migrationsDirectory, files)
    const liveFiles = await migrationFiles(liveMigrationsDirectory)
    const liveDigest = await migrationDigest(liveMigrationsDirectory, liveFiles)
    try {
      await rm(bundledMigrationsDirectory, { force: true, recursive: true })
      await rm(bundledLiveMigrationsDirectory, { force: true, recursive: true })
      await cp(migrationsDirectory, bundledMigrationsDirectory, { recursive: true })
      await cp(liveMigrationsDirectory, bundledLiveMigrationsDirectory, { recursive: true })

      if (digest !== generatedTemplateDigest || !(await exists(bundledProjectTemplate))) {
        await buildProjectTemplateArchive(bundledProjectTemplate, migrationsDirectory)
      }
      generatedTemplateDigest = digest
      if (liveDigest !== generatedLiveTemplateDigest || !(await exists(bundledLiveTemplate))) {
        await buildLiveTemplateArchive(bundledLiveTemplate, liveMigrationsDirectory)
      }
      generatedLiveTemplateDigest = liveDigest
    } catch (error) {
      generatedTemplateDigest = null
      generatedLiveTemplateDigest = null
      await Promise.all([
        rm(bundledMigrationsDirectory, { force: true, recursive: true }),
        rm(bundledProjectTemplate, { force: true }),
        rm(bundledLiveMigrationsDirectory, { force: true, recursive: true }),
        rm(bundledLiveTemplate, { force: true })
      ])
      throw error
    }
  }
}

export default defineConfig(({ mode }) => ({
  define: {
    __HERON_BUILD_MODE__: JSON.stringify(mode),
    __HERON_RELEASE__: JSON.stringify(
      releaseBuild(JSON.parse(appVersionDefine) as string, process.env)
    )
  },
  plugins: [projectMigrations],
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/main/index.ts"),
        "project-worker": resolve(import.meta.dirname, "src/main/project/project-worker.ts"),
        "live-worker": resolve(import.meta.dirname, "src/main/project/live-worker.ts")
      },
      formats: ["es"],
      fileName: (_format, entryName) =>
        entryName.endsWith("-worker") ? `${entryName}.mjs` : `${entryName}.js`
    },
    minify: false,
    outDir: resolve(import.meta.dirname, "out/main"),
    rolldownOptions: {
      external: [
        "electron",
        "electron-updater",
        "@sentry/electron/main",
        "@electric-sql/pglite",
        "@heron/dsp-node",
        ...nodeBuiltins
      ]
    },
    sourcemap: true,
    target: "node22"
  }
}))
