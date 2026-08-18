import assert from "node:assert/strict"
import test from "node:test"
import { createGenerator } from "unocss"

import unoConfig from "../uno.config.ts"

void test("the Heron UnoCSS config emits token-backed static utilities", async () => {
  const generator = await createGenerator(unoConfig)
  const { css, matched } = await generator.generate(`
    bg-ui-action
    hover:bg-ui-action-hover
    text-ui-text
    border-ui-border
    gap-ui-3
    rounded-ui-md
    z-[var(--ui-z-dialog)]
  `)

  assert.equal(matched.size, 7)
  assert.match(css, /background-color:var\(--ui-color-action\)/)
  assert.match(css, /background-color:var\(--ui-color-action-hover\)/)
  assert.match(css, /color:var\(--ui-color-text\)/)
  assert.match(css, /border-color:var\(--ui-color-border\)/)
  assert.match(css, /gap:var\(--ui-space-3\)/)
  assert.match(css, /border-radius:var\(--ui-radius-md\)/)
  assert.match(css, /z-index:var\(--ui-z-dialog\)/)
})
