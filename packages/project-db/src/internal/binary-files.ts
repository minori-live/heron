/// <reference types="emscripten" />

import { randomUUID } from "node:crypto"
import type { PGlite } from "@electric-sql/pglite"

/**
 * Binary files live in this instance's memory filesystem, outside the archived
 * PostgreSQL data directory. Each operation owns its path until its callback
 * completes, including when the callback is part of a Drizzle transaction.
 */
export class PgliteBinaryFiles {
  constructor(private readonly client: Pick<PGlite, "copyToFS" | "Module">) {}

  withBytes<T>(bytes: Uint8Array, operation: (path: string) => PromiseLike<T>): Promise<T> {
    return this.withPath(async (path) => {
      this.client.copyToFS(path, bytes, 0o600)
      return operation(path)
    })
  }

  readFrom(operation: (path: string) => PromiseLike<unknown>): Promise<Uint8Array> {
    return this.withPath(async (path) => {
      await operation(path)
      return this.client.Module.FS.readFile(path, { encoding: "binary" })
    })
  }

  private async withPath<T>(operation: (path: string) => PromiseLike<T>): Promise<T> {
    const path = `/tmp/heron-binary-${randomUUID()}`
    const filesystem = this.client.Module.FS
    try {
      return await operation(path)
    } finally {
      if (filesystem.analyzePath(path).exists) filesystem.unlink(path)
    }
  }
}
