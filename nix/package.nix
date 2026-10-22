{
  lib,
  stdenv,
  rustPlatform,
  rustfmt,
  nodejs_26,
  pnpm_12,
  electron_44,
  fetchFromGitHub,
  fetchurl,
  autoPatchelfHook,
  makeWrapper,
  wrapGAppsHook3,
  pkg-config,
  cmake,
  alsa-lib,
  libX11,
  libXcursor,
  libXrandr,
  libXinerama,
  libXext,
  libxcb,
  fontconfig,
  freetype,
  cairo,
  pango,
  gtk3,
  libGL,
  libxkbcommon,
  writableTmpDirAsHomeHook,
  writeText,
}:

let
  src = lib.cleanSource ../.;
  version = lib.trim (builtins.readFile ../VERSION);
  pnpm = pnpm_12.override { nodejs-slim = nodejs_26; };
  electron = electron_44;
  arch = if stdenv.hostPlatform.isAarch64 then "arm64" else "x64";
  pluginLock = builtins.fromJSON (builtins.readFile ../heron-plugins.lock.json);
  pluginRelease = pluginLock.release;
  pluginPlatform = "linux-${arch}";
  pluginRuntime = pluginRelease.assets.${pluginPlatform}.runtime;
  pluginFile = pluginRuntime.file;
  sources = import ./sources.nix;
  pnpmLock = import ./pnpm-lock.nix { inherit lib fetchurl writeText; };
  plugins = fetchurl {
    url = "https://github.com/${pluginLock.repository}/releases/download/v${pluginRelease.version}/${pluginFile}";
    hash = pluginRuntime.sha256;
  };
  vst3sdk = fetchFromGitHub {
    owner = "steinbergmedia";
    repo = "vst3sdk";
    inherit (sources.vst3sdk) rev hash;
    fetchSubmodules = true;
  };
  araSdk = fetchFromGitHub {
    owner = "Celemony";
    repo = "ARA_SDK";
    inherit (sources.araSdk) rev hash;
    fetchSubmodules = true;
  };
in
rustPlatform.buildRustPackage {
  pname = "heron";
  inherit version src;

  cargoLock.lockFile = ../Cargo.lock;

  nativeBuildInputs = [
    nodejs_26
    pnpm
    writableTmpDirAsHomeHook
    rustfmt
    rustPlatform.bindgenHook
    pkg-config
    cmake
    autoPatchelfHook
    makeWrapper
    wrapGAppsHook3
  ];
  buildInputs = [
    alsa-lib
    libX11
    libXcursor
    libXrandr
    libXinerama
    libXext
    libxcb
    fontconfig
    freetype
    cairo
    pango
    gtk3
    libGL
    libxkbcommon
    stdenv.cc.cc.lib
  ];

  ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  HERON_RELEASE_BUILD = "false";
  CARGO_NET_OFFLINE = "true";
  dontWrapGApps = true;
  # Preserve nixpkgs' Electron RPATH, including its dlopen-only dependencies.
  dontAutoPatchelf = true;
  dontPatchELF = true;

  # pnpm-lock.yaml names every registry tarball and its integrity. The
  # install talks to a localhost registry of those fetches, so lockfile
  # updates do not edit nix/sources.nix.
  preBuild = ''
    bash ${./pnpm-install.sh} \
      ${./pnpm-lock-registry.mjs} \
      ${pnpmLock.manifest} \
      ${stdenv.targetPlatform.node.arch} \
      ${stdenv.targetPlatform.node.platform}
  '';

  postPatch = ''
    mkdir -p third_party/vst3sdk third_party/ARA_SDK
    cp -r ${vst3sdk}/. third_party/vst3sdk/
    cp -r ${araSdk}/. third_party/ARA_SDK/
    chmod -R u+w third_party/vst3sdk third_party/ARA_SDK
  '';

  buildPhase = ''
    runHook preBuild
    # pnpm includes native build tools (Rolldown, esbuild, Sentry,
    # app-builder and fs-native-extensions) which must run in the sandbox.
    # extract-zip ships both libc variants in one package. These platforms
    # use glibc; its unused musl bindings must not enter ELF dependency checks.
    find node_modules -path '*/@electron-internal/extract-zip/*-musl.node' -delete
    autoPatchelf node_modules
    pnpm --filter @heron/dsp-node build
    node scripts/native-build.ts build --profile release
    mkdir -p target/plugin-artifacts/${pluginRelease.version}/${pluginPlatform}
    cp ${plugins} target/plugin-artifacts/${pluginRelease.version}/${pluginPlatform}/${pluginFile}
    pnpm plugins:prepare --offline
    pnpm build:desktop
    cp -r ${electron.dist} electron-dist
    chmod -R u+w electron-dist
    pnpm --filter @heron/desktop run pack --linux --${arch} \
      --config.electronDist="$PWD/electron-dist" \
      --config.electronVersion=${electron.version}
    pnpm --filter @heron/desktop verify:package-security
    runHook postBuild
  '';

  # The build verifies both database templates and renderer security;
  # also exercise the compiled N-API boundary, without audio hardware.
  checkPhase = ''
    runHook preCheck
    node scripts/integration/native-bindings.test.ts
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/heron"
    cp -r release/linux${lib.optionalString (arch == "arm64") "-arm64"}-unpacked/. "$out/lib/heron/"
    install -Dm644 ${./heron.desktop} "$out/share/applications/heron.desktop"
    for icon in apps/desktop/build/icons/*.png; do
      size=$(basename "$icon" .png)
      install -Dm644 "$icon" "$out/share/icons/hicolor/$size/apps/heron.png"
    done
    runHook postInstall
  '';

  postFixup = ''
    autoPatchelf "$out/lib/heron/resources"
    makeWrapper "$out/lib/heron/heron" "$out/bin/heron" \
      "''${gappsWrapperArgs[@]}" \
      --add-flags "--ozone-platform=x11"
  '';

  meta = {
    description = "Experimental cross-platform digital audio workstation";
    homepage = "https://heron.minori.live/";
    license = lib.licenses.gpl3Only;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
    mainProgram = "heron";
  };
}
