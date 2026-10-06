import { readFile, readdir } from "node:fs/promises"
import { relative, resolve } from "node:path"

const outputDirectory = resolve(import.meta.dirname, "../out/renderer")

for (const filename of [
  "index.html",
  "splash.html",
  "plugin-analysis.html",
  "plugin-analysis-eq-fit.html"
]) {
  const html = await readFile(resolve(outputDirectory, filename), "utf8")
  if (html.includes("__HERON_CONTENT_SECURITY_POLICY__")) {
    throw new Error(`${filename} still contains the CSP placeholder`)
  }
  if (!html.includes("connect-src 'none'")) {
    throw new Error(`${filename} does not block production renderer connections`)
  }
  if (/\bfont-src\s+([^;"<>]+)/u.exec(html)?.[1]?.trim() !== "'self'") {
    throw new Error(`${filename} does not restrict fonts to same-origin assets`)
  }
  if (/\bws:|localhost/i.test(html)) {
    throw new Error(`${filename} contains a development websocket source`)
  }
}

const assets = await readdir(outputDirectory, { recursive: true, withFileTypes: true })
for (const asset of assets) {
  if (!asset.isFile() || !/\.(?:css|js|html)$/iu.test(asset.name)) continue
  const assetPath = resolve(asset.parentPath, asset.name)
  const source = await readFile(assetPath, "utf8")
  if (
    /data:(?:font\/|application\/(?:x-font|font-|vnd\.ms-fontobject))/iu.test(source) ||
    /@font-face\b[^}]*\burl\(\s*["']?\s*data:/iu.test(source)
  ) {
    throw new Error(
      `${relative(outputDirectory, assetPath)} contains an inline font blocked by font-src 'self'`
    )
  }
}

console.log("Verified production CSP and external font assets in the renderer output")
