import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll } from "vitest"
import { PROJECT_MIGRATIONS_FOLDER } from "../../migrations"
import { ProjectDatabase } from "../../node"
import { buildProjectTemplateArchive } from "../../template"

export interface TestDatabase {
  database: ProjectDatabase
  directory: string
}

export interface ProjectDbFixture {
  /** Databases opened by tests in this file; closed and removed after each case. */
  readonly databases: TestDatabase[]
  /** Creates an independent real PGlite project, optionally on disk for reopen coverage. */
  createDatabase: (storage?: "memory" | "disk") => Promise<TestDatabase>
  /** Path to the reusable schema-only template built once for this test file. */
  templatePath: () => string
}

/**
 * Builds the generated project template once per file and tears down every
 * PGlite instance a test opened. Each case still gets an independent engine.
 */
export function useProjectDbFixture(): ProjectDbFixture {
  const databases: TestDatabase[] = []
  let templateDirectory: string
  let templateArchivePath: string

  beforeAll(async () => {
    templateDirectory = await mkdtemp(join(tmpdir(), "heron-project-template-test-"))
    templateArchivePath = join(templateDirectory, "project-template.pglite.gz")
    await buildProjectTemplateArchive(templateArchivePath, PROJECT_MIGRATIONS_FOLDER)
  }, 60_000)

  afterEach(async () => {
    for (const resource of databases.splice(0)) {
      await resource.database.close()
      await rm(resource.directory, { force: true, recursive: true })
    }
  })

  afterAll(async () => {
    await rm(templateDirectory, { force: true, recursive: true })
  })

  async function createDatabase(storage: "memory" | "disk" = "memory"): Promise<TestDatabase> {
    const directory = await mkdtemp(join(tmpdir(), "heron-project-db-"))
    const database = await ProjectDatabase.create(
      storage === "disk" ? join(directory, "pgdata") : "memory://",
      {
        name: "Test project",
        sampleRate: 48_000,
        numerator: 4,
        denominator: 4,
        waveformDisplayMode: "separate"
      },
      templateArchivePath
    )
    const result = { database, directory }
    databases.push(result)
    return result
  }

  return { databases, createDatabase, templatePath: () => templateArchivePath }
}
