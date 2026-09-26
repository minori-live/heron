import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ProjectConfiguration } from "@heron/contracts"

export interface WorkingCopyMetadata<TConfiguration = ProjectConfiguration> {
  id: string
  projectPath: string
  configuration: TConfiguration
  dirty: boolean
  archiveMtimeMs: number | null
  updatedAt: number
}

async function fileMtime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

export class ProjectWorkingCopyStore<TConfiguration = ProjectConfiguration> {
  constructor(private readonly userData: string) {}

  root(id: string): string {
    return join(this.userData, "workspaces", id)
  }

  async reset(workingRoot: string): Promise<void> {
    await rm(workingRoot, { recursive: true, force: true })
    await mkdir(workingRoot, { recursive: true })
  }

  async read(workingRoot: string): Promise<WorkingCopyMetadata<TConfiguration> | null> {
    try {
      return JSON.parse(
        await readFile(join(workingRoot, "session.json"), "utf8")
      ) as WorkingCopyMetadata<TConfiguration>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
  }

  async isRecoverable(workingRoot: string, projectPath: string): Promise<boolean> {
    const previous = await this.read(workingRoot)
    return Boolean(
      previous?.dirty &&
      previous.projectPath === projectPath &&
      previous.archiveMtimeMs === (await fileMtime(projectPath))
    )
  }

  async write(
    workingRoot: string,
    metadata: Omit<WorkingCopyMetadata<TConfiguration>, "archiveMtimeMs" | "updatedAt">
  ): Promise<void> {
    const path = join(workingRoot, "session.json")
    const value: WorkingCopyMetadata<TConfiguration> = {
      ...metadata,
      archiveMtimeMs: await fileMtime(metadata.projectPath),
      updatedAt: Date.now()
    }
    await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8")
    await rename(`${path}.tmp`, path)
  }

  async discard(workingRoot: string): Promise<void> {
    await rm(join(workingRoot, "pgdata"), { recursive: true, force: true })
    await rm(join(workingRoot, "session.json"), { force: true })
  }
}
