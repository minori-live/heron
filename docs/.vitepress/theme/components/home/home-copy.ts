import { computed, type ComputedRef } from "vue"
import { useData } from "vitepress"
import type { DownloadId } from "./home-downloads"

export type ProductKey = "studio" | "live" | "plugins"
export type InstallProduct = "daw" | "plugins"
export type InstallPlatform = "macos" | "windows" | "linux"

export interface HomeLink {
  label: string
  href: string
}

export interface ProductCopy {
  key: ProductKey
  tab: string
  kicker: string
  title: string
  body: string
  links: HomeLink[]
}

export interface ValueCopy {
  title: string
  body: string
}

export interface DownloadCopy {
  title: string
  detail: string
}

export interface InstallCommand {
  label: string
  lines: string[]
}

export interface InstallTarget {
  command?: InstallCommand
  note: string
}

export interface HomeCopy {
  deskLabel: string
  heroEyebrow: string
  heroTitle: string
  heroLead: string
  heroPrimary: string
  heroSecondary: string
  productsKicker: string
  productsTitle: string
  productsAria: string
  products: [ProductCopy, ProductCopy, ProductCopy]
  valuesKicker: string
  valuesPrice: string
  valuesTitle: string
  values: [ValueCopy, ValueCopy, ValueCopy, ValueCopy]
  installKicker: string
  installTitle: string
  installLead: string
  installProducts: Record<InstallProduct, string>
  installPlatforms: Record<InstallPlatform, string>
  installLatest: string
  installChecking: string
  installReleaseFallback: string
  installAllFiles: string
  download: string
  downloads: Record<DownloadId, DownloadCopy>
  copy: string
  copied: string
  install: Record<InstallProduct, Record<InstallPlatform, InstallTarget>>
  installGuide: Record<InstallProduct, HomeLink>
}

const en: HomeCopy = {
  deskLabel: "Heron Studio, Heron Live, Heron EQ, and Plugin Analysis windows working side by side",
  heroEyebrow: "Free and open-source music software",
  heroTitle: "From sketch to stage.",
  heroLead:
    "Heron is a DAW for writing in the studio and performing live, with plug-ins that go wherever you make music.",
  heroPrimary: "Get Heron",
  heroSecondary: "Explore the family",
  productsKicker: "The Heron family",
  productsTitle: "The studio, the stage, and every DAW in between.",
  productsAria: "Heron products",
  products: [
    {
      key: "studio",
      tab: "Studio",
      kicker: "Heron DAW · Studio",
      title: "Write, record, and mix.",
      body: "Arrange audio and MIDI on one musical timeline, record takes that stay recoverable until you save, and mix with buses, sends, and VST® 3 instruments and effects.",
      links: [
        { label: "DAW overview", href: "/daw/" },
        { label: "Plugin Analysis", href: "/daw/plugin-analysis" },
        { label: "Manual", href: "/manual/" }
      ]
    },
    {
      key: "live",
      tab: "Live",
      kicker: "Heron DAW · Live",
      title: "Take it to the stage.",
      body: "Prepare Sets and Patches in a standalone Live document, then switch sounds mid-performance. New plug-ins are ready before the audio moves, and Low Latency Mode keeps your monitoring tight.",
      links: [
        { label: "Live documents", href: "/manual/" },
        { label: "Low Latency Mode", href: "/manual/low-latency-mode" }
      ]
    },
    {
      key: "plugins",
      tab: "Plugins",
      kicker: "Heron Plugins",
      title: "Bring Heron to any DAW.",
      body: "A growing suite of free audio plug-ins with interactive displays that show what you hear. They come built into Heron, and install as VST 3 and Audio Unit plug-ins in the DAW you already use.",
      links: [
        { label: "Plugins manual", href: "/plugins/manual/" },
        { label: "Plugin releases", href: "/plugins/releases" }
      ]
    }
  ],
  valuesKicker: "Yours to keep",
  valuesPrice: "Free and open source.",
  valuesTitle: "No account. No subscription. No lock-in.",
  values: [
    {
      title: "Free software",
      body: "Heron is released under GPL-3.0, and its plug-ins are free to download. Read the code, change it, and share it."
    },
    {
      title: "Every desktop",
      body: "Windows, macOS, and Linux, each with native audio backends and the same workflow."
    },
    {
      title: "Projects you own",
      body: "Self-contained archives on your own disk, with working copies you can recover after a crash."
    },
    {
      title: "Built in the open",
      body: "Follow the roadmap, read the development log, and report issues on GitHub."
    }
  ],
  installKicker: "Get Heron",
  installTitle: "Ready when you are.",
  installLead:
    "Pick a product and your system. Heron is experimental: explore freely, but keep backups of important work.",
  installProducts: { daw: "Heron DAW", plugins: "Heron Plugins" },
  installPlatforms: { macos: "macOS", windows: "Windows", linux: "Linux" },
  installLatest: "Latest release",
  installChecking: "Checking the latest release…",
  installReleaseFallback: "Downloads available on the release page",
  installAllFiles: "All files and release notes",
  download: "Download",
  downloads: {
    "daw-mac": { title: "Heron for macOS", detail: "Universal · Apple silicon and Intel" },
    "daw-win": { title: "Heron for Windows", detail: "Installer · x64" },
    "daw-linux-x64": { title: "Heron for Linux", detail: "AppImage · x64" },
    "daw-linux-arm64": { title: "Heron for Linux", detail: "AppImage · arm64" },
    "plugins-mac": {
      title: "Heron Plugins for macOS",
      detail: "Disk image · VST 3 and Audio Unit"
    },
    "plugins-mac-vst3": { title: "VST 3 only", detail: "ZIP archive · Universal" },
    "plugins-mac-au": { title: "Audio Unit only", detail: "ZIP archive · Universal" },
    "plugins-win-vst3": { title: "Heron Plugins for Windows", detail: "VST 3 · x64" },
    "plugins-linux-x64": { title: "Heron Plugins for Linux", detail: "VST 3 · x64" },
    "plugins-linux-arm64": { title: "Heron Plugins for Linux", detail: "VST 3 · arm64" }
  },
  copy: "Copy",
  copied: "Copied",
  install: {
    daw: {
      macos: {
        command: {
          label: "Or install with Homebrew",
          lines: ["brew install --cask minori-live/tap/heron"]
        },
        note: "Requires macOS 14.2 or later. Homebrew keeps Heron up to date."
      },
      windows: {
        note: "Install the 64-bit ASIO® driver from your audio-interface manufacturer for low-latency work."
      },
      linux: {
        command: {
          label: "Then make it executable and run it",
          lines: ["chmod +x Heron-*.AppImage", "./Heron-*.AppImage"]
        },
        note: "Your desktop audio configuration decides which devices Heron can open."
      }
    },
    plugins: {
      macos: {
        note: "Open the disk image and use its installation shortcuts. Choose Audio Unit for Logic Pro."
      },
      windows: {
        note: "Copy each complete .vst3 bundle to your DAW's plug-in folder, then rescan."
      },
      linux: {
        note: "Copy each complete .vst3 bundle to your DAW's plug-in folder, then rescan."
      }
    }
  },
  installGuide: {
    daw: { label: "Installation guide", href: "/manual/install" },
    plugins: { label: "Plugin install guide", href: "/plugins/releases" }
  }
}

const zh: HomeCopy = {
  deskLabel: "Heron Studio、Heron Live、Heron EQ 与 Plugin Analysis 窗口并排工作",
  heroEyebrow: "自由、开源的音乐软件",
  heroTitle: "从灵感，到舞台。",
  heroLead:
    "Heron 是一款既能在工作室创作、也能在舞台演出的数字音频工作站，还有一套插件，陪你去任何创作的地方。",
  heroPrimary: "获取 Heron",
  heroSecondary: "了解产品家族",
  productsKicker: "Heron 产品家族",
  productsTitle: "工作室、舞台，以及你用的每一款 DAW。",
  productsAria: "Heron 产品",
  products: [
    {
      key: "studio",
      tab: "Studio",
      kicker: "Heron DAW · Studio",
      title: "创作、录音、混音。",
      body: "在同一条音乐时间线上编排音频与 MIDI，录音在保存前始终可以恢复，并用总线、发送以及 VST® 3 乐器和效果完成混音。",
      links: [
        { label: "DAW 概览", href: "/zh/daw/" },
        { label: "Plugin Analysis", href: "/zh/daw/plugin-analysis" },
        { label: "手册", href: "/zh/manual/" }
      ]
    },
    {
      key: "live",
      tab: "Live",
      kicker: "Heron DAW · Live",
      title: "把音乐带上舞台。",
      body: "在独立的 Live 文档中准备 Set 与 Patch，演出中随时切换音色。新插件在音频切换前就已就绪，低延迟模式让监听始终紧凑。",
      links: [
        { label: "Live 文档", href: "/zh/manual/" },
        { label: "低延迟模式", href: "/zh/manual/low-latency-mode" }
      ]
    },
    {
      key: "plugins",
      tab: "插件",
      kicker: "Heron Plugins",
      title: "把 Heron 带进任何 DAW。",
      body: "一套持续扩充的免费音频插件，用交互式显示让你看见所听到的声音。它们内置于 Heron，也能以 VST 3 与 Audio Unit 插件的形式安装到你正在使用的 DAW 中。",
      links: [
        { label: "插件手册", href: "/zh/plugins/manual/" },
        { label: "插件发布版本", href: "/zh/plugins/releases" }
      ]
    }
  ],
  valuesKicker: "属于你",
  valuesPrice: "免费，且开源。",
  valuesTitle: "没有账号，没有订阅，没有锁定。",
  values: [
    {
      title: "自由软件",
      body: "Heron 以 GPL-3.0 发布，插件也可免费下载。阅读代码、修改它、分享它。"
    },
    {
      title: "每一台电脑",
      body: "Windows、macOS 与 Linux，各自使用原生音频后端，工作流始终一致。"
    },
    { title: "工程属于你", body: "自包含的工程归档保存在你自己的磁盘上，崩溃后也能恢复工作副本。" },
    { title: "公开开发", body: "关注路线图，阅读开发日志，并在 GitHub 上反馈问题。" }
  ],
  installKicker: "获取 Heron",
  installTitle: "随时可以开始。",
  installLead: "选择产品与系统。Heron 仍是实验性软件：欢迎自由探索，但请备份好重要的工作。",
  installProducts: { daw: "Heron DAW", plugins: "Heron Plugins" },
  installPlatforms: { macos: "macOS", windows: "Windows", linux: "Linux" },
  installLatest: "最新版本",
  installChecking: "正在查询最新版本…",
  installReleaseFallback: "请前往发布页下载",
  installAllFiles: "全部文件与发布说明",
  download: "下载",
  downloads: {
    "daw-mac": { title: "Heron macOS 版", detail: "通用 · Apple silicon 与 Intel" },
    "daw-win": { title: "Heron Windows 版", detail: "安装程序 · x64" },
    "daw-linux-x64": { title: "Heron Linux 版", detail: "AppImage · x64" },
    "daw-linux-arm64": { title: "Heron Linux 版", detail: "AppImage · arm64" },
    "plugins-mac": { title: "Heron Plugins macOS 版", detail: "磁盘映像 · VST 3 与 Audio Unit" },
    "plugins-mac-vst3": { title: "仅 VST 3", detail: "ZIP 压缩包 · 通用" },
    "plugins-mac-au": { title: "仅 Audio Unit", detail: "ZIP 压缩包 · 通用" },
    "plugins-win-vst3": { title: "Heron Plugins Windows 版", detail: "VST 3 · x64" },
    "plugins-linux-x64": { title: "Heron Plugins Linux 版", detail: "VST 3 · x64" },
    "plugins-linux-arm64": { title: "Heron Plugins Linux 版", detail: "VST 3 · arm64" }
  },
  copy: "复制",
  copied: "已复制",
  install: {
    daw: {
      macos: {
        command: {
          label: "或使用 Homebrew 安装",
          lines: ["brew install --cask minori-live/tap/heron"]
        },
        note: "需要 macOS 14.2 或更高版本。Homebrew 会保持 Heron 为最新版本。"
      },
      windows: {
        note: "进行低延迟工作时，请安装音频接口厂商提供的 64 位 ASIO® 驱动。"
      },
      linux: {
        command: {
          label: "然后赋予执行权限并运行",
          lines: ["chmod +x Heron-*.AppImage", "./Heron-*.AppImage"]
        },
        note: "桌面音频配置决定了 Heron 可以打开哪些设备。"
      }
    },
    plugins: {
      macos: {
        note: "打开磁盘映像并使用其中的安装快捷方式。在 Logic Pro 中请选择 Audio Unit。"
      },
      windows: {
        note: "将每个完整的 .vst3 包复制到 DAW 的插件目录，然后重新扫描。"
      },
      linux: {
        note: "将每个完整的 .vst3 包复制到 DAW 的插件目录，然后重新扫描。"
      }
    }
  },
  installGuide: {
    daw: { label: "安装指南", href: "/zh/manual/install" },
    plugins: { label: "插件安装指南", href: "/zh/plugins/releases" }
  }
}

const homeCopy: Record<string, HomeCopy> = { root: en, zh }

export function useHomeCopy(): ComputedRef<HomeCopy> {
  const { localeIndex } = useData()
  return computed(() => homeCopy[localeIndex.value] ?? en)
}
