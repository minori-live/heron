import assert from "node:assert/strict"
import test from "node:test"

import {
  auditDesktopInteractionSource,
  auditDesktopScript,
  auditDesktopScopedCss,
  auditTemplate,
  auditVueTemplate,
  exportedStories
} from "./ui-boundary-policy.ts"

await test("rejects native interactive controls and events", () => {
  const violations = auditVueTemplate(`
    <template>
      <button @click="save">Save</button>
      <div tabindex="0" role="slider" @pointerdown="start" />
    </template>
  `)

  assert.ok(violations.some((violation) => violation.rule === "native-interactive"))
  assert.ok(violations.some((violation) => violation.rule === "native-interactive-role"))
  assert.ok(violations.some((violation) => violation.rule === "native-focus"))
  assert.ok(violations.some((violation) => violation.rule === "native-event"))
})

await test("allows product composition through @heron/ui components", () => {
  const violations = auditVueTemplate(`
    <template>
      <UiButton @click="save">Save</UiButton>
      <UiResizeHandle @gesture="resize" />
      <canvas aria-hidden="true" />
    </template>
  `)

  assert.deepEqual(violations, [])
})

await test("audits Storybook template strings with the same policy", () => {
  assert.equal(auditTemplate(`<UiButton>Save</UiButton>`).length, 0)
  assert.ok(auditTemplate(`<input aria-label="Name" />`).length > 0)
})

await test("rejects Desktop DOM gesture types and interaction CSS", () => {
  assert.ok(
    auditDesktopInteractionSource(
      "function drag(event: DragEvent) { event.dataTransfer }",
      "feature.ts"
    ).length > 0
  )
  assert.ok(auditDesktopScopedCss(`<style scoped>.item:hover { cursor: grab; }</style>`).length > 0)
})

await test("allows normalized intents and passive canvas styles", () => {
  assert.deepEqual(
    auditDesktopInteractionSource(
      "function drag(intent: UiGestureIntent) { return intent.delta.x }",
      "feature.ts"
    ),
    []
  )
  assert.deepEqual(auditDesktopScopedCss(`<style scoped>canvas { display: block; }</style>`), [])
})

await test("rejects direct UI-library imports and deep @heron/ui imports", () => {
  const violations = auditDesktopScript(`
    import { useTooltip } from "reka-ui"
    import * as echarts from "echarts"
    import { driver } from "driver.js"
    import UiButton from "@heron/ui/components/UiButton.vue"
  `)

  assert.equal(violations.filter((violation) => violation.rule === "ui-library-boundary").length, 3)
  assert.ok(violations.some((violation) => violation.rule === "ui-deep-import"))
})

await test("detects missing story exports and missing interactive play contracts", () => {
  const stories = exportedStories(`
    export const Default = {}
    export const Keyboard = { play: async () => undefined }
  `)

  assert.equal(stories.has("Missing"), false)
  assert.equal(stories.get("Default"), false)
  assert.equal(stories.get("Keyboard"), true)
})
