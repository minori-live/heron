import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/live-schema.ts",
  out: "./drizzle-live"
})
