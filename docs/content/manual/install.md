---
title: Install Heron
description: Download and start Heron on Windows, macOS, or Linux.
vstTrademark: true
asioTrademark: true
---

# Install Heron

Heron publishes installers for Windows, macOS, and Linux with each tagged
release.

## Download a release

1. Open [Heron Releases](https://github.com/minori-live/heron/releases).
2. Choose the newest release and expand **Assets**.
3. Download the file for your system:
   - **Windows x64:** `.exe`
   - **macOS Apple silicon or Intel:** universal `.dmg`
   - **Linux x64 or arm64:** `.AppImage`

If you have Heron 0.5.1 or earlier, install the first release using the new
update feed manually. Those versions look for update metadata in GitHub Release
assets; newer releases provide it through the Heron website instead. Automatic
updates resume after that installation.

::: tip No release listed?
Heron is experimental. If the Releases page has no published installer yet,
you can build it from source by following the
[development environment guide](https://github.com/minori-live/heron/blob/main/agents/docs/environment.md).
That process is intended for contributors.
:::

## Windows

Run the downloaded installer. Windows audio builds include ASIO® support. For
low-latency work, install the 64-bit ASIO driver supplied by your audio-interface
manufacturer before opening Heron.

If Windows warns about an unrecognized application, confirm that the download
came from the official repository before continuing.

## macOS

Heron requires macOS 14.2 or later and supports Apple silicon and Intel Macs.

Install using the [project-maintained Homebrew Tap](https://github.com/minori-live/homebrew-tap):

```sh
brew install --cask minori-live/tap/heron
```

Heron can download and install updates from inside the application. To upgrade
through Homebrew instead, close Heron and run:

```sh
brew update
brew upgrade --cask --greedy-auto-updates minori-live/tap/heron
```

Uninstall with `brew uninstall --cask minori-live/tap/heron`. This removes the
application while preserving projects and application data.

Alternatively, download the Universal DMG from the release page.

Open the `.dmg` and move Heron to Applications. The first launch may require
confirmation in **System Settings → Privacy & Security**, especially for an
experimental or unsigned build.

Allow microphone access when macOS asks; Heron needs that permission to record
from audio inputs.

### Nix

With [Nix](https://nixos.org/download/) flakes enabled:

```sh
nix run github:minori-live/heron
```

Install into your profile:

```sh
nix profile install github:minori-live/heron
```

On macOS with [nix-darwin](https://github.com/LnL7/nix-darwin), import the flake
module and enable the program:

```nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.nix-darwin.url = "github:LnL7/nix-darwin";
  inputs.nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  inputs.heron.url = "github:minori-live/heron";

  outputs = { nix-darwin, heron, ... }: {
    darwinConfigurations.example = nix-darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      modules = [
        heron.darwinModules.heron
        { programs.heron.enable = true; }
      ];
    };
  };
}
```

Use `x86_64-darwin` on an Intel Mac, and pin that configuration's nixpkgs to
`github:NixOS/nixpkgs/nixpkgs-26.05-darwin`. nixos-unstable no longer evaluates
Intel Macs; 26.05 is the last nixpkgs release with that toolchain. After
`darwin-rebuild switch`, `heron` is on `PATH` and nix-darwin copies `Heron.app`
to `/Applications/Nix Apps`. The
same home-manager module used on Linux also works on macOS:

```nix
{
  imports = [ inputs.heron.homeManagerModules.heron ];
  programs.heron.enable = true;
}
```

When home-manager's Darwin app linking is enabled, it links `Heron.app` into
the user Applications folder. The flake builds `aarch64-darwin` and
`x86_64-darwin` from the selected source revision. Bundled VST 3 plug-ins stay
inside the app, as they do on NixOS; the module does not install Audio Unit
bundles. The Nix build is ad-hoc signed, so the first launch may need the same
Privacy & Security confirmation as an unsigned disk image, including microphone
access. Building it runs `/bin/ps`, `codesign`, `plutil`, and `ditto`. Nix's
Darwin default leaves the sandbox off. If `/etc/nix/nix.conf` sets
`sandbox = true`, change that to `sandbox = false` or `sandbox = relaxed` and
restart the Nix daemon before `darwin-rebuild` or `nix build`. Update by updating the Heron input and running `darwin-rebuild switch`,
or by updating your Nix profile or home-manager configuration. See
[Nix distribution](https://github.com/minori-live/heron/blob/main/agents/docs/nix-distribution.md)
for the source build and dependency pins.

## Linux

### Nix

With [Nix](https://nixos.org/download/) flakes enabled:

```sh
nix run github:minori-live/heron
```

Install into your profile:

```sh
nix profile install github:minori-live/heron
```

On NixOS, import the flake module and enable the program:

```nix
{
  inputs.heron.url = "github:minori-live/heron";

  outputs = { nixpkgs, heron, ... }: {
    nixosConfigurations.example = nixpkgs.lib.nixosSystem {
      modules = [
        heron.nixosModules.heron
        { programs.heron.enable = true; }
      ];
    };
  };
}
```

With home-manager:

```nix
{
  imports = [ inputs.heron.homeManagerModules.heron ];
  programs.heron.enable = true;
}
```

The flake builds Heron from the selected source revision for `x86_64-linux`
and `aarch64-linux` (macOS systems are above). Use a release tag
(`github:minori-live/heron/vX.Y.Z`) or an exact commit to select a particular
version; the default URL uses the default branch. The build uses locked
dependencies and does not require a published Heron AppImage. Update through
your Nix profile or by updating the Heron input and rebuilding your NixOS or
home-manager configuration. See
[Nix distribution](https://github.com/minori-live/heron/blob/main/agents/docs/nix-distribution.md)
for the source build and dependency pins.

### AppImage

Make the AppImage executable, then run it:

```sh
chmod +x Heron-*.AppImage
./Heron-*.AppImage
```

Your desktop audio configuration determines which devices are available. Make
sure the user running Heron can access the selected device.

## First launch

Heron scans the system and user VST® 3 locations, starts its isolated audio
services, and opens the project workspace. A large plug-in collection can make
the first scan take longer than later launches.

Continue with [Your first project](first-project.md).
