import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, extname, join, relative, sep } from "node:path"
import {
  baseParse,
  ElementTypes,
  NodeTypes,
  type ElementNode,
  type RootNode
} from "@vue/compiler-dom"
import { parse as parseSfc } from "@vue/compiler-sfc"
import ts from "typescript"

import { UI_COMPONENT_CATALOG } from "../apps/design-system/src/component-catalog.ts"

export interface UiBoundaryViolation {
  file: string
  rule: string
  detail: string
}

const forbiddenNativeTags = new Set(["button", "input", "select", "textarea"])
const forbiddenInteractiveRoles = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "option",
  "radio",
  "scrollbar",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox"
])
const forbiddenNativeEvents = new Set([
  "auxclick",
  "blur",
  "change",
  "click",
  "contextmenu",
  "dblclick",
  "drag",
  "dragend",
  "dragenter",
  "dragleave",
  "dragover",
  "dragstart",
  "drop",
  "focus",
  "focusin",
  "focusout",
  "input",
  "keydown",
  "keypress",
  "keyup",
  "mousedown",
  "mousemove",
  "mouseup",
  "pointercancel",
  "pointerdown",
  "pointermove",
  "pointerover",
  "pointerup",
  "scroll",
  "submit",
  "touchcancel",
  "touchend",
  "touchmove",
  "touchstart",
  "wheel"
])

export function auditUiBoundaries(workspaceRoot: string): UiBoundaryViolation[] {
  const violations: UiBoundaryViolation[] = []
  const desktopRoot = join(workspaceRoot, "apps/desktop/src/renderer/src")
  const storyRoots = [
    join(workspaceRoot, "packages/ui/src/components"),
    join(workspaceRoot, "apps/design-system/src")
  ]

  for (const file of collectFiles(desktopRoot, new Set([".vue"]))) {
    const source = readFileSync(file, "utf8")
    violations.push(...auditVueTemplate(source, relative(workspaceRoot, file)))
    violations.push(...auditDesktopScript(source, relative(workspaceRoot, file)))
    violations.push(...auditDesktopInteractionSource(source, relative(workspaceRoot, file)))
    violations.push(...auditDesktopScopedCss(source, relative(workspaceRoot, file)))
  }

  for (const file of collectFiles(desktopRoot, new Set([".ts"]))) {
    if (file.endsWith(".test.ts") || file.endsWith(".spec.ts") || file.endsWith(".d.ts")) continue
    const source = readFileSync(file, "utf8")
    const name = relative(workspaceRoot, file)
    violations.push(...auditDesktopScript(source, name))
    violations.push(...auditDesktopInteractionSource(source, name))
  }

  for (const root of storyRoots) {
    for (const file of collectFiles(root, new Set([".ts", ".mdx"]))) {
      if (!file.endsWith(".stories.ts") && !file.endsWith(".mdx")) continue
      const source = readFileSync(file, "utf8")
      const name = relative(workspaceRoot, file)
      for (const template of storyTemplates(source)) {
        violations.push(...auditTemplate(template, name))
      }
      if (file.endsWith(".mdx")) violations.push(...auditMdx(source, name))
    }
  }

  violations.push(...auditCatalog(workspaceRoot))
  return violations
}

const allowedGlobalControllers = new Set([
  "apps/desktop/src/renderer/src/App.vue",
  "apps/desktop/src/renderer/src/views/StudioView.vue",
  "apps/desktop/src/renderer/src/composables/useApplicationCommands.ts",
  "apps/desktop/src/renderer/src/components/system-settings/ShortcutSettings.vue"
])

export function auditDesktopInteractionSource(
  source: string,
  file = "fixture.ts"
): UiBoundaryViolation[] {
  const normalized = file.split(sep).join("/")
  const violations: UiBoundaryViolation[] = []
  const alwaysForbidden = [
    "PointerEvent",
    "DragEvent",
    "WheelEvent",
    "MouseEvent",
    "DataTransfer",
    "setPointerCapture",
    "releasePointerCapture"
  ]
  for (const token of alwaysForbidden) {
    if (new RegExp(`\\b${token}\\b`).test(source))
      violations.push({
        file,
        rule: "dom-gesture-type",
        detail: `${token} must be owned by @heron/ui`
      })
  }
  if (!allowedGlobalControllers.has(normalized)) {
    if (/\bKeyboardEvent\b/.test(source))
      violations.push({
        file,
        rule: "dom-keyboard-type",
        detail: "KeyboardEvent is limited to approved global controllers"
      })
    if (/\b(?:useEventListener|addEventListener)\s*\(/.test(source))
      violations.push({
        file,
        rule: "global-listener",
        detail: "global listeners are limited to approved controllers"
      })
  }
  return violations
}

export function auditDesktopScopedCss(source: string, file = "fixture.vue"): UiBoundaryViolation[] {
  const violations: UiBoundaryViolation[] = []
  for (const match of source.matchAll(/<style\b[^>]*\bscoped\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = match[1] ?? ""
    if (/:hover|:focus(?:-visible|-within)?|:active/.test(css))
      violations.push({
        file,
        rule: "desktop-interaction-css",
        detail: "pseudo-state styling must be owned by @heron/ui"
      })
    if (/\.(?:dragging|pressed)\b/.test(css))
      violations.push({
        file,
        rule: "desktop-interaction-css",
        detail: "gesture-state styling must be owned by @heron/ui"
      })
    if (
      /cursor\s*:\s*(?:pointer|grab|grabbing|crosshair|(?:row|col|n|s|e|w|ns|ew|nesw|nwse)-resize)\b/.test(
        css
      )
    )
      violations.push({
        file,
        rule: "desktop-interaction-css",
        detail: "interactive cursors must be owned by @heron/ui"
      })
  }
  return violations
}

export function auditVueTemplate(source: string, file = "fixture.vue"): UiBoundaryViolation[] {
  const parsed = parseSfc(source, { filename: file })
  if (parsed.errors.length > 0 || !parsed.descriptor.template) return []
  return auditTemplate(parsed.descriptor.template.content, file)
}

export function auditTemplate(template: string, file = "fixture.vue"): UiBoundaryViolation[] {
  let root: RootNode
  try {
    root = baseParse(template)
  } catch {
    return [{ file, rule: "template-parse", detail: "template could not be parsed" }]
  }

  const violations: UiBoundaryViolation[] = []
  walk(root, (element) => {
    if (element.tagType !== ElementTypes.ELEMENT) return
    const tag = element.tag.toLowerCase()
    if (forbiddenNativeTags.has(tag)) {
      violations.push({ file, rule: "native-interactive", detail: `<${tag}> must use @heron/ui` })
    }
    if (tag === "a" && hasAttribute(element, "href")) {
      violations.push({
        file,
        rule: "native-interactive",
        detail: "interactive <a> must use @heron/ui"
      })
    }
    if (hasAttribute(element, "contenteditable")) {
      violations.push({
        file,
        rule: "native-interactive",
        detail: "contenteditable must use @heron/ui"
      })
    }
    const role = attributeValue(element, "role")
    if (role && forbiddenInteractiveRoles.has(role)) {
      violations.push({
        file,
        rule: "native-interactive-role",
        detail: `role=${role} must use @heron/ui`
      })
    }
    const tabindex = attributeValue(element, "tabindex")
    if (tabindex !== undefined && Number(tabindex) >= 0) {
      violations.push({
        file,
        rule: "native-focus",
        detail: `tabindex=${tabindex} must use @heron/ui`
      })
    }
    for (const property of element.props) {
      if (property.type !== NodeTypes.DIRECTIVE || property.name !== "on") continue
      const event = property.arg?.type === NodeTypes.SIMPLE_EXPRESSION ? property.arg.content : ""
      if (forbiddenNativeEvents.has(event.toLowerCase())) {
        violations.push({
          file,
          rule: "native-event",
          detail: `@${event} must be owned by @heron/ui`
        })
      }
    }
  })
  return violations
}

export function auditDesktopScript(source: string, file = "fixture.ts"): UiBoundaryViolation[] {
  const violations: UiBoundaryViolation[] = []
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1] ?? ""
    if (specifier === "reka-ui" || specifier === "echarts" || specifier === "driver.js") {
      violations.push({
        file,
        rule: "ui-library-boundary",
        detail: `${specifier} must be wrapped by @heron/ui`
      })
    }
    if (specifier.startsWith("@heron/ui/")) {
      violations.push({
        file,
        rule: "ui-deep-import",
        detail: "import from the @heron/ui package root"
      })
    }
  }
  return violations
}

function auditMdx(source: string, file: string): UiBoundaryViolation[] {
  const violations: UiBoundaryViolation[] = []
  for (const tag of forbiddenNativeTags) {
    if (new RegExp(`<${tag}\\b`, "i").test(source)) {
      violations.push({ file, rule: "native-interactive", detail: `<${tag}> must use @heron/ui` })
    }
  }
  return violations
}

function auditCatalog(workspaceRoot: string): UiBoundaryViolation[] {
  const violations: UiBoundaryViolation[] = []
  const indexFile = join(workspaceRoot, "packages/ui/src/index.ts")
  const indexSource = readFileSync(indexFile, "utf8")
  const publicComponents = [
    ...indexSource.matchAll(/export \{ default as (\w+) \} from "\.\/components\/[^"']+\.vue"/g)
  ]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
  const catalogNames = Object.keys(UI_COMPONENT_CATALOG)

  for (const name of publicComponents) {
    if (!(name in UI_COMPONENT_CATALOG)) {
      violations.push({
        file: relative(workspaceRoot, indexFile),
        rule: "catalog-missing",
        detail: name
      })
    }
  }
  for (const name of catalogNames) {
    if (!publicComponents.includes(name)) {
      violations.push({
        file: "apps/design-system/src/component-catalog.ts",
        rule: "catalog-orphan",
        detail: name
      })
    }
  }

  const storyFiles = collectFiles(
    join(workspaceRoot, "packages/ui/src/components"),
    new Set([".ts"])
  )
    .filter((file) => file.endsWith(".stories.ts"))
    .concat(
      collectFiles(join(workspaceRoot, "apps/design-system/src"), new Set([".ts"])).filter((file) =>
        file.endsWith(".stories.ts")
      )
    )

  for (const [name, entry] of Object.entries(UI_COMPONENT_CATALOG)) {
    const candidates = storyFiles.filter((file) => basename(file) === entry.storyFile)
    if (candidates.length !== 1) {
      violations.push({
        file: "apps/design-system/src/component-catalog.ts",
        rule: "catalog-story-file",
        detail: `${name}: ${entry.storyFile} resolved ${candidates.length} times`
      })
      continue
    }
    const candidate = candidates[0]
    if (!candidate) continue
    const source = readFileSync(candidate, "utf8")
    const stories = exportedStories(source)
    for (const story of entry.stories) {
      if (!stories.has(story)) {
        violations.push({
          file: relative(workspaceRoot, candidate),
          rule: "catalog-story",
          detail: `${name}: ${story}`
        })
      }
    }
    if (entry.interactive && !entry.stories.some((story) => stories.get(story) === true)) {
      violations.push({
        file: relative(workspaceRoot, candidate),
        rule: "catalog-play",
        detail: name
      })
    }
  }
  return violations
}

export function exportedStories(source: string): Map<string, boolean> {
  const file = ts.createSourceFile(
    "stories.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const stories = new Map<string, boolean>()
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
      continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      let initializer: ts.Expression = declaration.initializer
      if (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))
        initializer = initializer.expression
      const hasPlay =
        ts.isObjectLiteralExpression(initializer) &&
        initializer.properties.some(
          (property) =>
            (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) &&
            property.name !== undefined &&
            property.name.getText(file).replaceAll(/["']/g, "") === "play"
        )
      stories.set(declaration.name.text, hasPlay)
    }
  }
  return stories
}

function storyTemplates(source: string): string[] {
  return [...source.matchAll(/template\s*:\s*`([\s\S]*?)`/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]]
  )
}

function walk(root: RootNode, visit: (element: ElementNode) => void): void {
  const queue = [...root.children]
  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) continue
    if (node.type === NodeTypes.ELEMENT) {
      visit(node)
      queue.push(...node.children)
      for (const property of node.props) {
        if (
          property.type === NodeTypes.DIRECTIVE &&
          property.exp?.type === NodeTypes.COMPOUND_EXPRESSION
        ) {
          // Expressions are deliberately not treated as templates.
        }
      }
    } else if (node.type === NodeTypes.IF) {
      for (const branch of node.branches) queue.push(...branch.children)
    } else if (node.type === NodeTypes.FOR) {
      queue.push(...node.children)
    }
  }
}

function hasAttribute(element: ElementNode, name: string): boolean {
  return element.props.some(
    (property) => property.type === NodeTypes.ATTRIBUTE && property.name.toLowerCase() === name
  )
}

function attributeValue(element: ElementNode, name: string): string | undefined {
  const property = element.props.find(
    (candidate) => candidate.type === NodeTypes.ATTRIBUTE && candidate.name.toLowerCase() === name
  )
  return property?.type === NodeTypes.ATTRIBUTE ? (property.value?.content ?? "") : undefined
}

function collectFiles(directory: string, extensions: ReadonlySet<string>): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return collectFiles(path, extensions)
    return extensions.has(extname(path)) ? [path] : []
  })
}

export function formatUiBoundaryViolations(
  violations: readonly UiBoundaryViolation[]
): readonly string[] {
  return violations.map(
    (violation) => `${violation.file.split(sep).join("/")}: ${violation.rule}: ${violation.detail}`
  )
}

if (process.argv[1] && basename(process.argv[1]) === "ui-boundary-policy.ts") {
  const violations = auditUiBoundaries(process.cwd())
  if (violations.length > 0) {
    console.error(`UI boundary policy failed with ${violations.length} violation(s):`)
    for (const violation of formatUiBoundaryViolations(violations)) console.error(`- ${violation}`)
    process.exitCode = 1
  } else {
    console.log("UI boundary policy passed with zero violations.")
  }
}
