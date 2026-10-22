---
title: 安装 Heron
description: 在 Windows、macOS 或 Linux 上下载并启动 Heron。
vstTrademark: true
asioTrademark: true
---

# 安装 Heron

Heron 会为每个带标签的发布版本提供 Windows、macOS 与 Linux 安装包。

## 下载发布版本

1. 打开 [Heron 发布页面](https://github.com/minori-live/heron/releases)。
2. 选择最新的发布版本并展开 **Assets**。
3. 下载适合你系统的文件：
   - **Windows x64：** `.exe`
   - **macOS（Apple 芯片或 Intel）：** 通用 `.dmg`
   - **Linux x64 或 arm64：** `.AppImage`

如果你使用 Heron 0.5.1 或更早版本，需要手动安装首个采用新更新源的版本。
这些旧版本会从 GitHub Release 附件读取更新清单，而新版本改由 Heron 网站提供。
完成这次安装后，自动更新会恢复。

::: tip 没有可用的发布版本？
Heron 仍处于实验阶段。如果发布页面还没有可用的安装包，可以按照
[开发环境指南](https://github.com/minori-live/heron/blob/main/agents/docs/environment.md)
从源码构建。该流程面向贡献者。
:::

## Windows

运行下载的安装程序。Windows 音频构建包含 ASIO® 支持。要进行低延迟工作，
请在打开 Heron 前安装音频接口厂商提供的 64 位 ASIO 驱动。

如果 Windows 提示无法识别的应用，请在继续前确认下载来自官方仓库。

## macOS

Heron 要求 macOS 14.2 或更新版本，支持 Apple 芯片和 Intel Mac。

使用[项目维护的 Homebrew Tap](https://github.com/minori-live/homebrew-tap) 安装：

```sh
brew install --cask minori-live/tap/heron
```

Heron 支持在应用内下载并安装更新。如果希望通过 Homebrew 升级，请先关闭
Heron，然后运行：

```sh
brew update
brew upgrade --cask --greedy-auto-updates minori-live/tap/heron
```

运行 `brew uninstall --cask minori-live/tap/heron` 可以卸载应用；工程和应用数据会保留。

也可以从发布页面下载通用 DMG 安装包。

打开 `.dmg` 并将 Heron 拖入“应用程序”。首次启动可能需要在
**系统设置 → 隐私与安全性** 中确认，对于实验性或未签名的构建尤其如此。

当 macOS 请求麦克风权限时请允许；Heron 需要该权限才能从音频输入录音。

### Nix

在启用 [Nix](https://nixos.org/download/) flakes 的情况下：

```sh
nix run github:minori-live/heron
```

安装到用户 profile：

```sh
nix profile install github:minori-live/heron
```

在 macOS 上使用 [nix-darwin](https://github.com/LnL7/nix-darwin) 时，导入 flake
模块并启用：

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

Intel Mac 请把 `system` 设为 `x86_64-darwin`，并把该配置的 nixpkgs 固定到
`github:NixOS/nixpkgs/nixpkgs-26.05-darwin`。nixos-unstable 已不再能为 Intel Mac
求值；26.05 是仍包含该工具链的最后一个 nixpkgs 版本。执行 `darwin-rebuild switch`
后，`heron` 会出现在 `PATH` 中，nix-darwin 会把 `Heron.app` 复制到
`/Applications/Nix Apps`。Linux 上使用的 home-manager 模块在 macOS 上同样可用：

```nix
{
  imports = [ inputs.heron.homeManagerModules.heron ];
  programs.heron.enable = true;
}
```

若启用了 home-manager 的 Darwin 应用链接，它会把 `Heron.app` 链接到用户的
“应用程序”目录。该 flake 会从所选源码版本构建 `aarch64-darwin` 与
`x86_64-darwin`。与 NixOS 一样，内置 VST 3 插件位于应用包内；此模块不会安装
Audio Unit。Nix 构建使用临时签名，首次启动时可能需要像未签名磁盘映像一样在
**系统设置 → 隐私与安全性** 中确认，并允许麦克风访问。构建过程会调用
`/bin/ps`、`codesign`、`plutil` 和 `ditto`。Nix 在 Darwin 上默认关闭沙箱。若
`/etc/nix/nix.conf` 中为 `sandbox = true`，请改为 `sandbox = false` 或
`sandbox = relaxed`，重启 Nix 守护进程后再执行 `darwin-rebuild` 或 `nix build`。请更新 Heron 输入后执行
`darwin-rebuild switch`，或更新 Nix profile / home-manager 配置。源码构建与依赖
固定方式见
[Nix 分发说明](https://github.com/minori-live/heron/blob/main/agents/docs/nix-distribution.md)。

## Linux

### Nix

在启用 [Nix](https://nixos.org/download/) flakes 的情况下：

```sh
nix run github:minori-live/heron
```

安装到用户 profile：

```sh
nix profile install github:minori-live/heron
```

在 NixOS 中导入 flake 模块并启用：

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

使用 home-manager：

```nix
{
  imports = [ inputs.heron.homeManagerModules.heron ];
  programs.heron.enable = true;
}
```

该 flake 会从所选版本的 Heron 源码构建 `x86_64-linux` 与 `aarch64-linux`
软件包（macOS 见上文）。使用发布标签（`github:minori-live/heron/vX.Y.Z`）或精确提交来选择
特定版本；默认地址使用默认分支。构建使用锁定的依赖，无需等待 Heron AppImage
发布。请通过 Nix profile 更新，或更新 Heron 输入并重新构建 NixOS 或
home-manager 配置。源码构建与依赖固定方式见
[Nix 分发说明](https://github.com/minori-live/heron/blob/main/agents/docs/nix-distribution.md)。

### AppImage

为 AppImage 添加可执行权限，然后运行：

```sh
chmod +x Heron-*.AppImage
./Heron-*.AppImage
```

可用的设备取决于你的桌面音频配置。请确保运行 Heron 的用户可以访问所选设备。

## 首次启动

Heron 会扫描系统与用户的 VST® 3 位置，启动隔离的音频服务，并打开工程工作区。
插件较多时，首次扫描可能比之后的启动更慢。

继续阅读[第一个工程](first-project.md)。
