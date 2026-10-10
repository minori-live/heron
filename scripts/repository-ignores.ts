/**
 * Paths no repository tool should read.
 *
 * `eslint.config.ts`, `oxlint.config.ts` and `oxfmt.config.ts` each carried a
 * hand-copied version of this list. They had already drifted — the formatter
 * list also names lock files and generated TOML — so the shared part and the
 * formatter-only additions are separated here rather than in three files.
 */

/** Generated, vendored and build output directories and files. */
export const generatedAndBuildPaths = [
  ".agents/skills/",
  ".pnpm-store/",
  "apm_modules/",
  "**/.vitepress/cache/",
  "**/node_modules/",
  "**/dist/",
  "**/out/",
  "**/playwright-report/",
  "**/release/",
  "**/target/",
  "**/test-results/",
  "**/third_party/",
  "crates/.dsp-node.napi-stage-*/",
  "**/.napi-rs-filesystem-transaction*.swp/",
  "crates/dsp-node/index.d.ts",
  "crates/dsp-node/index.js",
  // Emitted by `mise run codegen:wire-types`; the Rust protocol owns the shape.
  "apps/desktop/src/main/audio-host/wire/generated/",
  "packages/contracts/src/generated/",
  "packages/project-db/drizzle/meta/"
]

/**
 * What the formatter must leave byte-identical.
 *
 * Beyond the generated paths above, lock files and every TOML source are
 * maintained by their own tools and by hand.
 */
export const formatIgnorePatterns = [
  ...generatedAndBuildPaths,
  "**/*.toml",
  "Cargo.lock",
  "apm.lock.yaml",
  "mise.lock",
  "pnpm-lock.yaml"
]
