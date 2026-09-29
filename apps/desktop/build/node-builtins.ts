import { builtinModules } from "node:module"

/**
 * Node built-ins, in both bare and `node:` form.
 *
 * Electron's main and preload bundles share this list so Vite externalises the
 * same module set for both; the renderer never imports them.
 */
export const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)]
