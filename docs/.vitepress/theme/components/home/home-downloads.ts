import { onMounted, ref, watch, type Ref } from "vue"
import type { InstallPlatform, InstallProduct } from "./home-copy"

export type DownloadId =
  | "daw-mac"
  | "daw-win"
  | "daw-linux-x64"
  | "daw-linux-arm64"
  | "plugins-mac"
  | "plugins-mac-vst3"
  | "plugins-mac-au"
  | "plugins-win-vst3"
  | "plugins-linux-x64"
  | "plugins-linux-arm64"

export interface DownloadAsset {
  id: DownloadId
  /** Matches the versioned file name in a GitHub release. */
  match: RegExp
  primary?: boolean
}

export const releaseRepos: Record<InstallProduct, string> = {
  daw: "minori-live/heron",
  plugins: "minori-live/heron-plugins"
}

export const releasesPage = (product: InstallProduct): string =>
  `https://github.com/${releaseRepos[product]}/releases/latest`

export const downloadAssets: Record<InstallProduct, Record<InstallPlatform, DownloadAsset[]>> = {
  daw: {
    macos: [{ id: "daw-mac", match: /-mac-universal\.dmg$/, primary: true }],
    windows: [{ id: "daw-win", match: /-win-x64\.exe$/, primary: true }],
    linux: [
      { id: "daw-linux-x64", match: /-linux-x86_64\.AppImage$/, primary: true },
      { id: "daw-linux-arm64", match: /-linux-arm64\.AppImage$/ }
    ]
  },
  plugins: {
    macos: [
      { id: "plugins-mac", match: /-macos-universal\.dmg$/, primary: true },
      { id: "plugins-mac-vst3", match: /-macos-universal-vst3\.zip$/ },
      { id: "plugins-mac-au", match: /-macos-universal-au2\.zip$/ }
    ],
    windows: [{ id: "plugins-win-vst3", match: /-windows-x64-vst3\.zip$/, primary: true }],
    linux: [
      { id: "plugins-linux-x64", match: /-linux-x64-vst3\.zip$/, primary: true },
      { id: "plugins-linux-arm64", match: /-linux-arm64-vst3\.zip$/ }
    ]
  }
}

export interface ReleaseFile {
  name: string
  url: string
  size: number
}

export interface LatestRelease {
  version: string
  publishedAt: Date
  files: ReleaseFile[]
}

interface GitHubRelease {
  tag_name: string
  published_at: string
  assets: { name: string; size: number; browser_download_url: string }[]
}

const cache = new Map<string, Promise<LatestRelease | undefined>>()

function fetchLatest(repo: string): Promise<LatestRelease | undefined> {
  let pending = cache.get(repo)
  if (!pending) {
    pending = fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" }
    })
      .then(async (response) => {
        if (!response.ok) return undefined
        const release = (await response.json()) as GitHubRelease
        return {
          version: release.tag_name.replace(/^v/, ""),
          publishedAt: new Date(release.published_at),
          files: release.assets.map((asset) => ({
            name: asset.name,
            url: asset.browser_download_url,
            size: asset.size
          }))
        }
      })
      .catch(() => undefined)
    cache.set(repo, pending)
  }
  return pending
}

/**
 * The latest published release of `product`, resolved in the browser so the
 * page links straight to versioned files. It stays undefined until the request
 * resolves, and also when GitHub cannot be reached; download links then fall
 * back to the release page.
 */
export function useLatestRelease(product: Ref<InstallProduct>): {
  release: Ref<LatestRelease | undefined>
  loading: Ref<boolean>
} {
  const release = ref<LatestRelease>()
  const loading = ref(true)
  const load = async () => {
    const requested = product.value
    release.value = undefined
    loading.value = true
    const result = await fetchLatest(releaseRepos[requested])
    if (product.value === requested) {
      release.value = result
      loading.value = false
    }
  }
  onMounted(load)
  watch(product, load)
  return { release, loading }
}

export function findFile(release: LatestRelease | undefined, asset: DownloadAsset) {
  return release?.files.find((file) => asset.match.test(file.name))
}

export function formatSize(bytes: number, locale: string): string {
  const megabytes = bytes / 1024 ** 2
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(megabytes)} MB`
}
