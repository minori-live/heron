{
  lib,
  stdenv,
  pkgs,
  rustPlatform,
  rustfmt,
  nodejs_26,
  pnpm_12,
  fetchFromGitHub,
  fetchurl,
  makeWrapper,
  pkg-config,
  cmake,
  writableTmpDirAsHomeHook,
  writeText,
}:

let
  src = lib.cleanSource ../.;
  version = lib.trim (builtins.readFile ../VERSION);
  pnpm = pnpm_12.override { nodejs-slim = nodejs_26; };
  isDarwin = stdenv.hostPlatform.isDarwin;
  arch = if stdenv.hostPlatform.isAarch64 then "arm64" else "x64";
  sources = import ./sources.nix;
  electron = pkgs.electron_44;
  pluginLock = builtins.fromJSON (builtins.readFile ../heron-plugins.lock.json);
  pluginRelease = pluginLock.release;
  pluginPlatform = if isDarwin then "macos-universal" else "linux-${arch}";
  pluginRuntime = pluginRelease.assets.${pluginPlatform}.runtime;
  pluginFile = pluginRuntime.file;
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
  packTarget = if isDarwin then "mac" else "linux";
in
rustPlatform.buildRustPackage (
  {
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
      makeWrapper
    ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [
      pkgs.autoPatchelfHook
      pkgs.wrapGAppsHook3
    ];
    buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
      pkgs.alsa-lib
      pkgs.libX11
      pkgs.libXcursor
      pkgs.libXrandr
      pkgs.libXinerama
      pkgs.libXext
      pkgs.libxcb
      pkgs.fontconfig
      pkgs.freetype
      pkgs.cairo
      pkgs.pango
      pkgs.gtk3
      pkgs.libGL
      pkgs.libxkbcommon
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
      ${lib.optionalString stdenv.hostPlatform.isLinux ''
        # pnpm includes native build tools (Rolldown, esbuild, Sentry,
        # app-builder and fs-native-extensions) which must run in the sandbox.
        # extract-zip ships both libc variants in one package. These platforms
        # use glibc; its unused musl bindings must not enter ELF dependency checks.
        find node_modules -path '*/@electron-internal/extract-zip/*-musl.node' -delete
        autoPatchelf node_modules
      ''}
      pnpm --filter @heron/dsp-node build
      node scripts/native-build.ts build --profile release
      mkdir -p target/plugin-artifacts/${pluginRelease.version}/${pluginPlatform}
      cp ${plugins} target/plugin-artifacts/${pluginRelease.version}/${pluginPlatform}/${pluginFile}
      pnpm plugins:prepare --offline
      pnpm build:desktop
      cp -r ${electron.dist} electron-dist
      chmod -R u+w electron-dist
      ${lib.optionalString isDarwin ''
        # Pack and fuse verification call Apple's codesign and plutil. Keep
        # them ahead of PATH only for that step so the Nix toolchain stays
        # the compiler for the rest of the build.
        export PATH="/usr/bin:$PATH"
        export CSC_IDENTITY_AUTO_DISCOVERY=false
      ''}
      pnpm --filter @heron/desktop run pack --${packTarget} --${arch} \
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

    installPhase =
      if isDarwin then
        ''
          runHook preInstall
          apps=()
          while IFS= read -r app; do
            apps+=("$app")
          done < <(find release -type d -name 'Heron.app')
          if [ "''${#apps[@]}" -ne 1 ]; then
            printf 'Expected one Heron.app under release/, found %s\n' "''${#apps[@]}" >&2
            find release -maxdepth 3 -print >&2 || true
            exit 1
          fi
          mkdir -p "$out/Applications" "$out/bin"
          /usr/bin/ditto "''${apps[0]}" "$out/Applications/Heron.app"
          exe="$out/Applications/Heron.app/Contents/MacOS/heron"
          if [ ! -x "$exe" ]; then
            printf 'Packaged macOS executable is missing: %s\n' "$exe" >&2
            exit 1
          fi
          makeWrapper "$exe" "$out/bin/heron"
          /usr/bin/codesign --verify --deep --strict "$out/Applications/Heron.app"
          runHook postInstall
        ''
      else
        ''
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

    postFixup = lib.optionalString stdenv.hostPlatform.isLinux ''
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
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      mainProgram = "heron";
    };
  }
  // lib.optionalAttrs isDarwin {
    # The app is already ad-hoc signed. Stripping or rewriting it drops the
    # signature electron-builder embedded for the bundled plug-ins.
    dontStrip = true;
    dontFixup = true;
    # napi-rs reads the process start time from /bin/ps, and packaging runs
    # Apple's codesign, plutil, and ditto. The strict Darwin sandbox allowlist
    # does not include those binaries. Nix honors this opt-out for
    # `sandbox = false` and `sandbox = relaxed`, and rejects the derivation
    # when `sandbox = true`.
    __noChroot = true;
  }
)
