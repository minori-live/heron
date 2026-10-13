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

## Execution backends by platform

Released Revox packages include ONNX Runtime and embedded models. The plug-in
selects its execution backend automatically; there is no manual backend selector.
The chart on the [product page](../heron-revox.md) summarizes the backends included
in the released packages.

| Platform              | Backends (priority order) | Notes                                  |
| --------------------- | ------------------------- | -------------------------------------- |
| macOS · Apple Silicon | CoreML → CPU              | CoreML is available with CPU fallback. |
| macOS · Intel         | CPU                       | Uses the bundled CPU runtime.          |
| Windows · x64         | CPU                       | Uses the bundled CPU runtime.          |
| Linux · x64           | CPU                       | Uses the bundled CPU runtime.          |
| Linux · arm64         | CPU                       | Uses the bundled CPU runtime.          |

On Apple Silicon, individual operators may fall back to CPU. CoreML availability
does not mean the entire model runs on the GPU or Neural Engine; performance
depends on the machine and DAW workload.

## Related pages

- [Heron Revox introduction](../heron-revox.md)
- [Plugin releases](../releases.md)
- [Plug-in manual overview](index.md)
