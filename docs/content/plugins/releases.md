---
title: Plugin releases
description: Download Heron plug-ins for Windows, macOS, and Linux, and install them in your DAW.
vstTrademark: true
---

# Plugin releases

<PluginCompatibility />

Download [Heron EQ](heron-eq.md) as part of the Heron Plugins suite from
[Heron Plugins releases](https://github.com/minori-live/heron-plugins/releases).
Each release includes downloads and release notes for the plug-in suite.

Also see the [Heron Revox](heron-revox.md) introduction. TODO: confirm when
Revox ships in the published suite and document its install package names.

Heron Plugins has its own releases, separate from
[Heron DAW releases](https://github.com/minori-live/heron/releases).
Use the plug-in downloads to install Heron EQ in another DAW.

## Choose a download

Open a release's **Assets** section and choose the package for your operating
system, processor, and the plug-in format supported by your DAW.

| Platform                        | Formats                   | Download                                                                                |
| ------------------------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| macOS · Apple Silicon and Intel | VST® 3, Audio Unit (AUv2) | Universal `.dmg`, or the `macos-universal-vst3.zip` / `macos-universal-au2.zip` archive |
| Windows · x64                   | VST 3                     | Archive ending in `windows-x64-vst3.zip`                                                |
| Linux · x64                     | VST 3                     | Archive ending in `linux-x64-vst3.zip`                                                  |
| Linux · arm64                   | VST 3                     | Archive ending in `linux-arm64-vst3.zip`                                                |

Archive names begin with `heron-plugins-` followed by the suite version.
On macOS, choose Audio Unit for Logic Pro, or the format supported by your host.

## Install Heron EQ

1. Quit your DAW before installing or replacing a plug-in.
2. On macOS, open the DMG and use its format folders and installation shortcuts.
   For a ZIP download, extract the archive and find Heron EQ in `bundles/`.
3. Copy the complete `Heron EQ.vst3` or `Heron EQ.component` bundle to your
   DAW's plug-in location. Keep the bundle intact, including its resources.
4. Restart the DAW and rescan its plug-in catalog if needed. Add **Heron EQ**
   to an audio effect slot.

The downloads contain the plug-in suite; you can install only the Heron EQ
bundle. Continue with the [plug-in manual](manual/index.md) for usage instructions.

<HeronStudioIncluded />
