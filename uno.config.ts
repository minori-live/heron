import { defineConfig, presetMini } from "unocss"

export const heronUnoColorNames = [
  "action",
  "action-hover",
  "action-pressed",
  "action-text",
  "border",
  "border-strong",
  "canvas",
  "canvas-subtle",
  "control",
  "control-hover",
  "control-pressed",
  "danger",
  "danger-hover",
  "danger-text",
  "focus",
  "info",
  "overlay",
  "selection",
  "selection-border",
  "selection-hover",
  "success",
  "surface",
  "surface-active",
  "surface-hover",
  "surface-raised",
  "text",
  "text-inverse",
  "text-muted",
  "text-subtle",
  "warning"
] as const

const colors = Object.fromEntries(
  heronUnoColorNames.map((name) => [`ui-${name}`, `var(--ui-color-${name})`])
)

const spacing = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((step) => [`ui-${step}`, `var(--ui-space-${step})`])
)

export default defineConfig({
  content: {
    filesystem: [
      "apps/desktop/src/renderer/**/*.{vue,ts}",
      "apps/design-system/**/*.{vue,ts,mdx}",
      "packages/ui/src/**/*.{vue,ts}"
    ]
  },
  presets: [presetMini({ preflight: false })],
  theme: {
    colors,
    spacing,
    borderRadius: {
      "ui-sm": "var(--ui-radius-sm)",
      "ui-md": "var(--ui-radius-md)",
      "ui-lg": "var(--ui-radius-lg)",
      "ui-pill": "var(--ui-radius-pill)"
    },
    boxShadow: {
      "ui-sm": "var(--ui-shadow-sm)",
      "ui-md": "var(--ui-shadow-md)",
      "ui-lg": "var(--ui-shadow-lg)"
    },
    fontFamily: {
      "ui-interface": "var(--ui-type-family-interface)",
      "ui-display": "var(--ui-type-family-display)",
      "ui-data": "var(--ui-type-family-data)"
    },
    fontSize: {
      "ui-xs": "var(--ui-font-size-xs)",
      "ui-sm": "var(--ui-font-size-sm)",
      "ui-md": "var(--ui-font-size-md)",
      "ui-lg": "var(--ui-font-size-lg)",
      "ui-xl": "var(--ui-font-size-xl)",
      "ui-2xl": "var(--ui-font-size-2xl)"
    },
    lineHeight: {
      "ui-tight": "var(--ui-type-leading-tight)",
      "ui-compact": "var(--ui-type-leading-compact)",
      "ui-normal": "var(--ui-type-leading-normal)",
      "ui-relaxed": "var(--ui-type-leading-relaxed)"
    }
  },
  shortcuts: {
    "ui-fill-available": "min-w-0 min-h-0",
    "ui-inline-center": "inline-flex items-center justify-center",
    "ui-stack": "grid gap-ui-4"
  }
})
