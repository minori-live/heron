import { defineConfig } from "oxfmt"

import { formatIgnorePatterns } from "./scripts/repository-ignores.ts"

export default defineConfig({
  arrowParens: "always",
  endOfLine: "lf",
  printWidth: 100,
  proseWrap: "preserve",
  semi: false,
  singleQuote: false,
  sortPackageJson: false,
  tabWidth: 2,
  trailingComma: "none",
  useTabs: false,
  vueIndentScriptAndStyle: false,
  ignorePatterns: formatIgnorePatterns
})
