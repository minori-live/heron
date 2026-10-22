import { createHash } from "node:crypto"
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"

const manifestPath = process.argv[2]
const portFile = process.argv[3]
if (!manifestPath || !portFile) {
  console.error("usage: pnpm-lock-registry.mjs <manifest.json> <port-file>")
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const byPath = new Map()
const shasums = new Map()

for (const [name, versions] of Object.entries(manifest)) {
  const unscoped = name.slice(name.lastIndexOf("/") + 1)
  for (const [version, info] of Object.entries(versions)) {
    byPath.set(`/${name}/-/${unscoped}-${version}.tgz`, info)
  }
}

function requestPath(url) {
  const path = url.split("?")[0] ?? "/"
  try {
    return decodeURIComponent(path).replace(/\/+$/u, "") || "/"
  } catch {
    return path
  }
}

function shasum(file) {
  const cached = shasums.get(file)
  if (cached) return cached
  const digest = createHash("sha1").update(readFileSync(file)).digest("hex")
  shasums.set(file, digest)
  return digest
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload)
  })
  response.end(payload)
}

function packument(host, name, versions) {
  const body = {
    name,
    "dist-tags": { latest: Object.keys(versions)[0] },
    versions: {}
  }
  for (const [version, info] of Object.entries(versions)) {
    const unscoped = name.slice(name.lastIndexOf("/") + 1)
    body.versions[version] = {
      name,
      version,
      dist: {
        integrity: info.integrity,
        shasum: shasum(info.tarball),
        tarball: `http://${host}/${name}/-/${unscoped}-${version}.tgz`
      }
    }
  }
  return body
}

const server = createServer((request, response) => {
  const path = requestPath(request.url ?? "/")
  const host = request.headers.host ?? "127.0.0.1"
  const tarball = byPath.get(path)
  if (tarball) {
    if (request.method === "HEAD") {
      const size = statSync(tarball.tarball).size
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": size
      })
      response.end()
      return
    }
    if (request.method === "GET") {
      const size = statSync(tarball.tarball).size
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": size
      })
      createReadStream(tarball.tarball).pipe(response)
      return
    }
  }

  const name = path.startsWith("/") ? path.slice(1) : path
  const versions = manifest[name]
  if (versions && (request.method === "GET" || request.method === "HEAD")) {
    sendJson(response, 200, packument(host, name, versions))
    return
  }

  console.error(`pnpm registry ${request.method} ${path} -> 404`)
  sendJson(response, 404, { error: "not found" })
})

server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  if (!address || typeof address === "string") {
    console.error("pnpm registry did not bind a TCP port")
    process.exit(1)
  }
  writeFileSync(portFile, String(address.port))
  console.error(`pnpm registry listening on 127.0.0.1:${address.port}`)
})
