{
  lib,
  stdenv,
  fetchurl,
  appimageTools,
  makeWrapper,
}:

let
  release = import ./release.nix;
  pname = "heron";
  inherit (release) version;

  archSuffix =
    if stdenv.hostPlatform.isx86_64 then
      "x86_64"
    else if stdenv.hostPlatform.isAarch64 then
      "arm64"
    else
      throw "Heron Linux AppImages are only published for x86_64 and aarch64";

  system = stdenv.hostPlatform.system;
  hash = release.hashes.${system} or (throw "No Heron release hash for ${system}");

  src = fetchurl {
    url = "https://github.com/minori-live/heron/releases/download/v${version}/Heron-${version}-linux-${archSuffix}.AppImage";
    inherit hash;
  };

  appimageContents = appimageTools.extract { inherit pname version src; };
in
appimageTools.wrapType2 {
  inherit pname version src;

  # ALSA / PipeWire / JACK and common desktop libs beyond the default AppImage FHS set.
  extraPkgs =
    pkgs: with pkgs; [
      alsa-lib
      jack2
      libpulseaudio
      pipewire
      libGL
      libglvnd
      mesa
      vulkan-loader
      wayland
      libxkbcommon
    ];

  extraInstallCommands = ''
    source ${makeWrapper}/nix-support/setup-hook

    # wrapType2 historically installed `$out/bin/<pname>-<version>`; newer
    # nixpkgs may already expose `$out/bin/<pname>`.
    if [[ -e "$out/bin/${pname}-${version}" ]]; then
      mv -f "$out/bin/${pname}-${version}" "$out/bin/${pname}"
    elif [[ ! -e "$out/bin/${pname}" ]]; then
      echo "Expected $out/bin/${pname} or $out/bin/${pname}-${version}; found:" >&2
      ls -la "$out/bin" >&2
      exit 1
    fi

    # Prefer the desktop entry and icons shipped inside the AppImage.
    if [[ -f ${appimageContents}/heron.desktop ]]; then
      install -Dm644 ${appimageContents}/heron.desktop \
        "$out/share/applications/heron.desktop"
      sed -i -e 's/^Exec=.*/Exec=heron/' "$out/share/applications/heron.desktop"
    else
      install -Dm644 ${./heron.desktop} "$out/share/applications/heron.desktop"
    fi

    if [[ -d ${appimageContents}/usr/share/icons ]]; then
      mkdir -p "$out/share"
      cp -Lr ${appimageContents}/usr/share/icons "$out/share/"
    elif [[ -f ${appimageContents}/heron.png ]]; then
      install -Dm644 ${appimageContents}/heron.png \
        "$out/share/icons/hicolor/256x256/apps/heron.png"
    fi

    # Match electron-builder's Linux launch policy (X11 / XWayland editors).
    wrapProgram "$out/bin/${pname}" \
      --add-flags "--ozone-platform=x11"
  '';

  meta = {
    description = "Experimental cross-platform digital audio workstation";
    longDescription = ''
      Heron packages the official Linux AppImage from GitHub Releases so the
      Nix output matches the binary users get from the website and other
      channels. Building the Electron renderer plus Rust native addon from
      source under Nix is intentionally not provided: it would duplicate the
      mise/pnpm/Cargo release pipeline and diverge from signed release
      artifacts.
    '';
    homepage = "https://heron.minori.live/";
    changelog = "https://github.com/minori-live/heron/releases/tag/v${version}";
    license = lib.licenses.gpl3Only;
    sourceProvenance = with lib.sourceTypes; [ binaryNativeCode ];
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
    mainProgram = "heron";
  };
}
