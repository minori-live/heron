---
title: Heron Revox
description: Overview of Heron Revox, a neural network vocoder for vocal phase cleanup, pitch shifting, and harmony layers.
vstTrademark: true
---

# Heron Revox

Heron Revox is a plug-in driven by a neural network vocoder. It removes phase
problems in vocals and supports pitch shifting up or down with much less loss.
It works especially well for harmonies and similar vocal-layering scenarios.

For the product introduction, see [Heron Revox](../heron-revox.md).

![Heron Revox editor with Semitones and Cents controls](/plugins/heron-revox.png)

## Get started

1. When a download is available, [install the Heron plug-ins](../releases.md) for
   your operating system and the format supported by your DAW.
2. Restart your DAW and rescan its plug-in catalog if needed.
3. Add **Heron Revox** as an audio effect on a vocal track and open its editor.

TODO: Document editor controls, parameters, and workflow in more detail.

## GPU acceleration by platform

Revox uses ONNX Runtime with a fixed execution-provider chain. Available GPU
backends register first; CPU is always the final fallback. There is no manual
backend selector. The chart on the [product page](../heron-revox.md) summarizes
compiled providers; details below reflect what
[heron-plugins](https://github.com/minori-live/heron-plugins) compiles and
registers today—not a claim that every operator runs on the GPU.

| Platform              | Backends (priority order)                       | Notes                                                                                                                                                                     |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS · Apple Silicon | CoreML → WebGPU → CPU                           | CoreML is the primary path and has been exercised on Apple Silicon. WebGPU (Dawn) is experimental upstream.                                                               |
| macOS · Intel         | CPU (default)                                   | No pinned ORT rc.14 prebuilt for Intel macOS. Ship as CPU-only unless an external ORT build is provided through `ORT_LIB_PATH` (then CoreML → WebGPU → CPU can register). |
| Windows · x64         | TensorRT RTX → TensorRT → CUDA → DirectML → CPU | Compiled into the Windows x64 package. GPU backends need matching drivers/runtimes; hardware validation is still outstanding.                                             |
| Linux · x64           | TensorRT RTX → TensorRT → CUDA → CPU            | Compiled into the Linux x64 package. Needs CUDA/TensorRT runtimes; hardware validation is still outstanding. No Vulkan EP.                                                |
| Linux · arm64         | TensorRT RTX → TensorRT → CUDA → CPU            | Same registration chain as Linux x64. Needs CUDA/TensorRT runtimes; hardware validation is still outstanding. No Vulkan EP.                                               |

There is no Metal or Vulkan ONNX execution provider in the Revox chain. A
registered provider does not prove every operator runs on the GPU. CUDA and
TensorRT builds need matching NVIDIA runtimes (CUDA 13.2+ / cuDNN 9.23+ for the
current ORT package).

## Related pages

- [Heron Revox introduction](../heron-revox.md)
- [Plugin releases](../releases.md)
- [Plug-in manual overview](index.md)
