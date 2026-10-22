#!/usr/bin/env bash
set -euo pipefail

package="$(realpath "${1:?usage: smoke.sh <package> <plugin-platform>}")"
platform="${2:?usage: smoke.sh <package> <plugin-platform>}"

if [[ -d "$package/Applications/Heron.app" ]]; then
  resources="$package/Applications/Heron.app/Contents/Resources"
  test -x "$package/bin/heron"
  test -x "$package/Applications/Heron.app/Contents/MacOS/heron"
else
  resources="$package/lib/heron/resources"
  test -x "$package/bin/heron"
  test -f "$package/share/applications/heron.desktop"
fi

manifest="$resources/plugins/bundle-manifest.json"
probe="$resources/heron-vst3-probe"
test -f "$resources/app.asar"
test -x "$probe"
test -x "$resources/heron-clap-probe"
jq -e --arg platform "$platform" '
  .schemaVersion == 1 and .platform == $platform and (.plugins | length >= 4)
' "$manifest"
plugins="$(jq -er '.plugins[] | [.bundleName, .nativeId, .kind] | @tsv' "$manifest")"

while IFS=$'\t' read -r bundle class_id kind; do
  case "$kind" in
    effect | instrument) ;;
    *) printf 'Unsupported plug-in kind: %s\n' "$kind" >&2; exit 1 ;;
  esac

  # Run the layout child directly: the discovery parent deliberately tolerates
  # teardown crashes after JSON is flushed. CI requires processing and exit 0.
  printf 'Processing stereo audio with %s\n' "$bundle"
  output="$(timeout --kill-after=5s 30s env \
    HERON_VST3_PROBE_CLASS="$class_id" \
    HERON_VST3_PROBE_LAYOUT="$kind:stereo" \
    "$probe" "$resources/plugins/$bundle")"
  printf '%s\n' "$output"
  jq -e '
    .supported == true and
    any(.buses[]; .direction == "output" and .kind == "main" and .channels == 2)
  ' <<< "$output"
done <<< "$plugins"

printf 'Installed built-in plug-ins processed audio and exited successfully.\n'
