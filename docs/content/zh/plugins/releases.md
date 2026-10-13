---
title: 插件发布版本
description: 下载适用于 Windows、macOS 和 Linux 的 Heron 插件，并安装到你的 DAW。
vstTrademark: true
---

# 插件发布版本

<PluginCompatibility locale="zh" />

前往 [Heron Plugins 发布页](https://github.com/minori-live/heron-plugins/releases)，
下载包含 [Heron EQ](heron-eq.md) 的 Heron Plugins 插件套件。
每个版本都附有套件的下载文件和更新说明。

另见 [Heron Revox](heron-revox.md) 介绍。TODO：确认 Revox 何时随已发布套件提供，并补充其安装包名称。

Heron Plugins 独立于 [Heron DAW](https://github.com/minori-live/heron/releases) 发布。
要在其他 DAW 中使用 Heron EQ，请下载独立插件。

## 选择下载文件

展开发布页的 **Assets**，根据操作系统、处理器架构，以及 DAW 支持的插件格式选择文件。

| 平台                           | 格式                       | 下载文件                                                                                |
| ------------------------------ | -------------------------- | --------------------------------------------------------------------------------------- |
| macOS · Apple Silicon 与 Intel | VST® 3、Audio Unit（AUv2） | 通用版 `.dmg`，或以 `macos-universal-vst3.zip` / `macos-universal-au2.zip` 结尾的压缩包 |
| Windows · x64                  | VST 3                      | 以 `windows-x64-vst3.zip` 结尾的压缩包                                                  |
| Linux · x64                    | VST 3                      | 以 `linux-x64-vst3.zip` 结尾的压缩包                                                    |
| Linux · arm64                  | VST 3                      | 以 `linux-arm64-vst3.zip` 结尾的压缩包                                                  |

压缩包文件名以 `heron-plugins-` 和套件版本号开头。
在 macOS 上，Logic Pro 用户选择 Audio Unit；其他宿主请选择其支持的格式。

## 安装 Heron EQ

1. 安装或替换插件前，退出 DAW。
2. 在 macOS 上，打开 DMG，使用其中的格式文件夹和安装快捷方式。
   如果下载的是 ZIP，解压后在 `bundles/` 中找到 Heron EQ。
3. 将完整的 `Heron EQ.vst3` 或 `Heron EQ.component` 插件包复制到 DAW 的插件目录。
   保留包内的全部文件与资源。
4. 重新启动 DAW，必要时重新扫描插件目录，然后在音频效果插槽中添加 **Heron EQ**。

下载文件包含整个插件套件，你可以只安装 Heron EQ。
安装后的操作请参阅[插件手册](manual/index.md)。

<HeronStudioIncluded locale="zh" />
