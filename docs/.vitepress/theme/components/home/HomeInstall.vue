<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useData, withBase } from "vitepress"
import PlatformIcon from "../product/PlatformIcon.vue"
import DownloadCard from "./DownloadCard.vue"
import SegmentedControl from "./SegmentedControl.vue"
import { useHomeCopy, type InstallPlatform, type InstallProduct } from "./home-copy"
import {
  downloadAssets,
  findFile,
  formatSize,
  releasesPage,
  useLatestRelease
} from "./home-downloads"
import { useRevealOnce } from "./home-motion"

const t = useHomeCopy()
const { lang } = useData()
const root = ref<HTMLElement>()
const shown = useRevealOnce(root, 0.15)
const product = ref<InstallProduct>("daw")
const platform = ref<InstallPlatform>("macos")
const copied = ref(false)
const { release, loading: releaseLoading } = useLatestRelease(product)

const platformIcons = { macos: "macOS", windows: "Windows", linux: "Linux" } as const

const productOptions = computed(() =>
  (["daw", "plugins"] as const).map((value) => ({ value, label: t.value.installProducts[value] }))
)
const platformOptions = computed(() =>
  (["macos", "windows", "linux"] as const).map((value) => ({
    value,
    label: t.value.installPlatforms[value]
  }))
)
const target = computed(() => t.value.install[product.value][platform.value])
const allFiles = computed(() => releasesPage(product.value))

const downloads = computed(() =>
  downloadAssets[product.value][platform.value].map((asset) => {
    const file = findFile(release.value, asset)
    return {
      ...asset,
      ...t.value.downloads[asset.id],
      href: file?.url ?? allFiles.value,
      // Alternatives are named by their title; long versioned names would only truncate there.
      file:
        file &&
        (asset.primary
          ? `${file.name} · ${formatSize(file.size, lang.value)}`
          : formatSize(file.size, lang.value))
    }
  })
)
const primary = computed(() => downloads.value.find((download) => download.primary))
const alternatives = computed(() => downloads.value.filter((download) => !download.primary))

const releaseSummary = computed(() => {
  if (!release.value) return undefined
  const date = new Intl.DateTimeFormat(lang.value, { dateStyle: "medium" }).format(
    release.value.publishedAt
  )
  return `v${release.value.version} · ${date}`
})

const commandLines = computed(() =>
  (target.value.command?.lines ?? []).map((line) => {
    const [program = "", ...args] = line.split(" ")
    return { line, program, args: args.join(" ") }
  })
)
const guide = computed(() => t.value.installGuide[product.value])

onMounted(() => {
  const agent = navigator.userAgent
  if (/Windows/i.test(agent)) platform.value = "windows"
  else if (/Linux/i.test(agent) && !/Android/i.test(agent)) platform.value = "linux"
})

let resetCopied = 0
async function copyCommand() {
  const lines = target.value.command?.lines
  if (!lines) return
  try {
    await navigator.clipboard.writeText(lines.join("\n"))
  } catch {
    return
  }
  copied.value = true
  window.clearTimeout(resetCopied)
  resetCopied = window.setTimeout(() => {
    copied.value = false
  }, 1600)
}
</script>

<template>
  <section id="get-heron" ref="root" class="install reveal" :class="{ 'is-shown': shown }">
    <div class="install__inner">
      <img
        class="install__mark reveal-line"
        style="--line: 0"
        :src="withBase('/logo.png')"
        alt=""
      />
      <p class="home-kicker reveal-line" style="--line: 1">{{ t.installKicker }}</p>
      <h2 class="home-heading reveal-line" style="--line: 2">{{ t.installTitle }}</h2>
      <p class="install__lead reveal-line" style="--line: 3">{{ t.installLead }}</p>

      <div class="install__controls reveal-line" style="--line: 4">
        <SegmentedControl v-model="product" :options="productOptions" :label="t.installKicker" />
        <div class="install__row">
          <SegmentedControl
            v-model="platform"
            :options="platformOptions"
            :label="t.installKicker"
            size="small"
          >
            <template #icon="{ value }"><PlatformIcon :name="platformIcons[value]" /></template>
          </SegmentedControl>
          <span class="install__release" :class="{ 'is-ready': releaseSummary }">
            <i aria-hidden="true" />
            {{
              releaseSummary
                ? `${t.installLatest} · ${releaseSummary}`
                : releaseLoading
                  ? t.installChecking
                  : t.installReleaseFallback
            }}
          </span>
        </div>
      </div>

      <Transition name="install-swap" mode="out-in">
        <div :key="`${product}-${platform}`" class="install__target">
          <DownloadCard
            v-if="primary"
            primary
            :href="primary.href"
            :title="primary.title"
            :detail="primary.detail"
            :file="primary.file"
            :platform="platformIcons[platform]"
            :action="t.download"
          />
          <div v-if="alternatives.length" class="install__alternatives">
            <DownloadCard
              v-for="download in alternatives"
              :key="download.id"
              :href="download.href"
              :title="download.title"
              :detail="download.detail"
              :file="download.file"
              :platform="platformIcons[platform]"
              :action="t.download"
            />
          </div>
          <div v-if="target.command" class="install__block">
            <div class="install__head">
              <span>{{ target.command.label }}</span>
              <button type="button" :class="{ 'is-done': copied }" @click="copyCommand">
                {{ copied ? t.copied : t.copy }}
              </button>
            </div>
            <pre><code><span v-for="command in commandLines" :key="command.line" class="install__line"><span class="install__prompt" aria-hidden="true">$</span><span class="install__cmd">{{ command.program }}</span> {{ command.args }}</span></code></pre>
          </div>
          <p class="install__note">{{ target.note }}</p>
        </div>
      </Transition>

      <p class="install__links reveal-line" style="--line: 5">
        <a :href="allFiles">{{ t.installAllFiles }} <span aria-hidden="true">→</span></a>
        <a :href="withBase(guide.href)">{{ guide.label }} <span aria-hidden="true">→</span></a>
      </p>
    </div>
  </section>
</template>

<style scoped>
.install {
  padding: clamp(96px, 12vw, 150px) 24px clamp(80px, 10vw, 120px);
  scroll-margin-top: calc(var(--vp-nav-height) - 40px);
}

.install__inner {
  max-width: 780px;
  margin: 0 auto;
}

.install__mark {
  width: 64px;
  height: 64px;
  margin-bottom: 32px;
  border-radius: 16px;
  box-shadow: 0 14px 30px -12px var(--home-shadow);
}

.install__lead {
  max-width: 580px;
  margin: 14px 0 32px;
  color: var(--home-ink-2);
  font-size: 18px;
  line-height: 1.55;
}

.install__controls {
  display: grid;
  justify-items: start;
  gap: 10px;
  margin-bottom: 14px;
}

.install__controls > :first-child {
  width: 100%;
}

.install__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
}

.install__release {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--home-ink-2);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.install__release i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--home-ink-2);
  opacity: 0.4;
  transition:
    background 300ms ease,
    opacity 300ms ease;
}

.install__release.is-ready i {
  background: var(--home-green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--home-green) 22%, transparent);
  opacity: 1;
}

.install__alternatives {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.install__target {
  display: grid;
  gap: 12px;
}

.install__block {
  overflow: hidden;
  border-radius: 16px;
  background: var(--home-fill);
}

.install__head {
  display: flex;
  height: 40px;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 0 18px;
  color: var(--home-ink-2);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.install__head button {
  height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  color: var(--home-ink-2);
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s;
}

.install__head button:hover {
  color: var(--home-ink);
  background: var(--home-fill);
}

.install__head button.is-done {
  color: var(--home-cyan-ink);
}

.install__block pre {
  margin: 0;
  padding: 2px 18px 16px;
  overflow-x: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  line-height: 1.8;
}

.install__line {
  display: block;
  white-space: pre;
}

.install__prompt {
  display: inline-block;
  width: 2ch;
  color: var(--home-ink-2);
  opacity: 0.6;
  user-select: none;
}

.install__cmd {
  color: var(--home-violet-ink);
  font-weight: 650;
}

.install__note {
  margin: 0 2px;
  color: var(--home-ink-2);
  font-size: 14px;
  line-height: 1.55;
}

.install__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 28px 0 0;
}

.install__links a {
  color: var(--home-ink);
  font-size: 15px;
  font-weight: 650;
  text-decoration: none;
}

.install__links a span {
  display: inline-block;
  color: var(--home-violet-ink);
  transition: transform 160ms ease;
}

.install__links a:hover span {
  transform: translateX(3px);
}

.install-swap-enter-active,
.install-swap-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.3s var(--home-ease);
}

.install-swap-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.install-swap-leave-to {
  opacity: 0;
}

@media (max-width: 560px) {
  .install {
    padding-inline: 16px;
  }

  .install__row > :first-child {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .install-swap-enter-active,
  .install-swap-leave-active {
    transition: none;
  }
}
</style>
