import { resolve } from "node:path"
import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"
import { appVersionDefine } from "./build/app-version.ts"

const isConstrainedWindowsCi = process.platform === "win32" && process.env.CI === "true"

export default defineConfig({
  plugins: [
    vue(),
    VueI18nPlugin({
      strictMessage: false,
      runtimeOnly: true
    })
  ],
  define: {
    __APP_VERSION__: appVersionDefine
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src/renderer/src")
    }
  },
  test: {
    // Node 26 exposes its own file-backed Web Storage globals. Disable them in
    // test workers so happy-dom can install its isolated in-memory storage.
    execArgv: ["--no-experimental-webstorage"],
    restoreMocks: true,
    // GitHub's Windows runners occasionally starve test workers while the
    // filesystem-heavy suites run in parallel. Bound concurrency there instead
    // of retrying tests and masking deterministic failures. Projects run one at
    // a time, so the limit stays at two workers for the whole desktop suite.
    maxWorkers: isConstrainedWindowsCi ? 2 : undefined,
    testTimeout: isConstrainedWindowsCi ? 15_000 : undefined,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/renderer/src/**/*.{ts,vue}", "src/main/**/*.ts", "src/shared/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/renderer/src/test/**",
        // Bundle-only entry points are exercised by build and E2E checks. Keeping
        // them out of uncovered-file remapping also avoids parsing raw TS as JS.
        "src/renderer/src/main.ts",
        "src/renderer/src/splash/main.ts",
        "src/main/**/*.d.ts",
        "src/renderer/src/**/*.d.ts"
      ]
    },
    // Main-process and shared tests do not touch the DOM, so they run under the
    // much cheaper Node environment. Only the renderer project pays the
    // happy-dom environment cost, which is created once per test file.
    projects: [
      {
        extends: true,
        test: {
          name: "main",
          environment: "node",
          include: ["src/main/**/*.test.ts", "src/shared/**/*.test.ts"]
        }
      },
      {
        extends: true,
        test: {
          name: "renderer",
          environment: "happy-dom",
          setupFiles: [resolve(import.meta.dirname, "src/renderer/src/test/setup.ts")],
          include: ["src/renderer/src/**/*.test.ts"],
          // happy-dom is expensive to construct, and the default `forks` pool
          // creates it once per test file. `vmThreads` keeps per-file isolation
          // while reusing one environment per worker.
          pool: "vmThreads"
        }
      }
    ]
  }
})
