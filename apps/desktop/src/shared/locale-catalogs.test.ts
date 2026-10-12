import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { baseParse, NodeTypes, type TemplateChildNode, type RootNode } from "@vue/compiler-dom"
import { parse } from "@vue/compiler-sfc"
import ts from "typescript"
import { APPLICATION_COMMAND_IDS } from "@heron/contracts"
import { APP_LOCALES, type MessageTree } from "./i18n"

const sourceRoot = resolve(import.meta.dirname, "..")
function flatten(tree: MessageTree, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([key, value]) =>
      typeof value === "string"
        ? [[prefix + key, value]]
        : Object.entries(flatten(value, `${prefix}${key}.`))
    )
  )
}
const catalogs = APP_LOCALES.map((locale) =>
  flatten(JSON.parse(readFileSync(resolve(sourceRoot, "locales", `${locale}.json`), "utf8")))
)
const english = catalogs[0]!
const sourceFiles = readdirSync(sourceRoot, { recursive: true, encoding: "utf8" }).filter(
  (file) => /\.(ts|vue)$/u.test(file) && !/\.test\.|(?:^|[/\\])test(?:[/\\])/u.test(file)
)

// Protocol examples, unit symbols, product names, compact controls, and required trademark text.
const literalExceptions = new Set([
  "GPL-3.0-only",
  "ASIO is a registered trademark of Steinberg Media Technologies GmbH.",
  "VST is a registered trademark of Steinberg Media Technologies GmbH.",
  "Bnc",
  "ARA",
  "Hz",
  "0 dB",
  "dB",
  "Rust · CPAL",
  "lead-synth",
  "vst3:1234",
  "MIDI",
  "ms",
  "BPM",
  "lowercase-slug"
])

describe("desktop locale catalogs", () => {
  it("keeps keys, nonempty messages, and interpolation parameters aligned", () => {
    const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/gu) ?? [])].sort()
    for (const catalog of catalogs) {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(english).sort())
      for (const [key, message] of Object.entries(catalog)) {
        expect(message.trim(), key).not.toBe("")
        expect(placeholders(message), key).toEqual(placeholders(english[key]!))
      }
    }
  })

  it("resolves literal translation references and dynamically selected MIDI commands and states", () => {
    for (const file of sourceFiles) {
      const source = readFileSync(resolve(sourceRoot, file), "utf8")
      for (const match of source.matchAll(/\bt\(["']([^"']+)["']/gu)) {
        expect(english[match[1]!], `${file}: ${match[1]}`).toBeTypeOf("string")
      }
    }
    for (const command of APPLICATION_COMMAND_IDS) {
      expect(english[`settings.shortcuts.commands.${command}`]).toBeTypeOf("string")
    }
    for (const state of ["internal", "waiting", "locking", "locked", "freewheel", "lost"]) {
      expect(english[`midiSettings.sync.${state}`]).toBeTypeOf("string")
    }
  })

  it("keeps static and bound user-facing Vue text and labels in the catalogs", () => {
    const untranslated: string[] = []
    for (const file of sourceFiles.filter((file) => file.endsWith(".vue"))) {
      const template = parse(readFileSync(resolve(sourceRoot, file), "utf8")).descriptor.template
      if (!template) continue
      const check = (text: string) => {
        const value = text.trim()
        if (/[a-z]{2}/iu.test(value) && !literalExceptions.has(value)) {
          untranslated.push(`${file}: ${value}`)
        }
      }
      const checkExpression = (expression: string) => {
        const source = ts.createSourceFile(
          "expression.ts",
          `(${expression})`,
          ts.ScriptTarget.Latest,
          true
        )
        const visitExpression = (node: ts.Node): void => {
          // Translation keys and parameters are supplied data, not UI literals.
          if (ts.isCallExpression(node)) return
          if (
            (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node)) &&
            /(?:[a-z]{2,}\s|\s[a-z]{2,})/iu.test(node.text)
          )
            check(node.text)
          ts.forEachChild(node, visitExpression)
        }
        visitExpression(source)
      }
      const visit = (node: RootNode | TemplateChildNode): void => {
        if (node.type === NodeTypes.TEXT) check(node.content)
        if (
          node.type === NodeTypes.INTERPOLATION &&
          node.content.type === NodeTypes.SIMPLE_EXPRESSION
        )
          checkExpression(node.content.content)
        if (node.type === NodeTypes.ELEMENT) {
          const hasProp = (name: string) =>
            node.props.some((prop) =>
              prop.type === NodeTypes.ATTRIBUTE
                ? prop.name === name
                : prop.name === "bind" &&
                  prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
                  prop.arg.content === name
            )
          const requireProp = (name: string) => {
            if (!hasProp(name)) untranslated.push(`${file}: ${node.tag} requires localized ${name}`)
          }
          if (node.tag === "UiDialog") requireProp("close-label")
          if (node.tag === "UiButton" && hasProp("loading")) requireProp("loading-label")
          if (node.tag === "UiCurveEditor") {
            for (const name of [
              "label",
              "instructions",
              "hint",
              "value-text",
              "x-label",
              "y-label"
            ])
              requireProp(name)
          }
          for (const prop of node.props) {
            if (
              prop.type === NodeTypes.DIRECTIVE &&
              prop.name === "bind" &&
              prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
              /(?:label|title|description|placeholder|valuetext)$/u.test(prop.arg.content) &&
              prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION
            )
              checkExpression(prop.exp.content)
            if (
              prop.type === NodeTypes.ATTRIBUTE &&
              /(?:label|title|description|placeholder|eyebrow|category|page)$/u.test(prop.name) &&
              prop.value
            ) {
              check(prop.value.content)
            }
          }
        }
        if (node.type === NodeTypes.ROOT || node.type === NodeTypes.ELEMENT) {
          node.children.forEach(visit)
        }
      }
      visit(baseParse(template.content))
    }
    expect(untranslated).toEqual([])
  })
})
