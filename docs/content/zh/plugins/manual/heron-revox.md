---
title: Heron Revox
description: Heron Revox 概览：面向人声相位清理、音高变换与和声叠层的神经网络声码器插件。
vstTrademark: true
---

# Heron Revox

Heron Revox 是一款由神经网络声码器驱动的插件。它可消除人声中的相位问题，并支持
上移或下移音高且损耗更小。尤其适合和声与类似的人声叠层场景。

功能概览请参阅 [Heron Revox](../heron-revox.md)。

![Heron Revox 编辑器，含 Semitones 与 Cents 控件](/plugins/heron-revox.png)

## 开始使用

1. 下载可用后，按操作系统与 DAW 支持的格式[安装 Heron 插件](../releases.md)。
2. 重新启动 DAW，必要时重新扫描插件目录。
3. 在人声轨上添加 **Heron Revox** 音频效果，并打开编辑器。

TODO：后续补充更详细的编辑器控件、参数与工作流程说明。

## 各平台执行后端

Revox 正式包包含 ONNX Runtime 和内嵌模型。插件自动选择执行后端，没有手动后端
选择器。[产品页](../heron-revox.md)上的图示概括了正式包中包含的后端。

| 平台                  | 后端（优先级） | 说明                             |
| --------------------- | -------------- | -------------------------------- |
| macOS · Apple Silicon | CoreML → CPU   | 可使用 CoreML，并保留 CPU 回退。 |
| macOS · Intel         | CPU            | 使用随包提供的 CPU 运行时。      |
| Windows · x64         | CPU            | 使用随包提供的 CPU 运行时。      |
| Linux · x64           | CPU            | 使用随包提供的 CPU 运行时。      |
| Linux · arm64         | CPU            | 使用随包提供的 CPU 运行时。      |

在 Apple Silicon 上，个别算子可能回退到 CPU。CoreML 可用不代表整个模型都在 GPU
或神经网络引擎上运行；实际性能取决于机器和 DAW 的工作负载。

## 相关页面

- [Heron Revox 介绍](../heron-revox.md)
- [插件发布版本](../releases.md)
- [插件手册概览](index.md)
