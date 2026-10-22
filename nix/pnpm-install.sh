#!/bin/sh
# Install from the per-package tarballs addressed by pnpm-lock.yaml.
# The registry listens only on localhost; each tarball hash is the lockfile
# integrity, so this build has no aggregate pnpm fixed-output hash.
set -eu

registry_script=$1
manifest=$2
arch=$3
platform=$4
port_file=$(mktemp)

node "$registry_script" "$manifest" "$port_file" &
registry_pid=$!

cleanup() {
  kill "$registry_pid" 2>/dev/null || true
  wait "$registry_pid" 2>/dev/null || true
}

i=0
while [ ! -s "$port_file" ]; do
  i=$((i + 1))
  if [ "$i" -gt 100 ] || ! kill -0 "$registry_pid" 2>/dev/null; then
    echo "pnpm lock registry did not listen" >&2
    cleanup
    exit 1
  fi
  sleep 0.1
done

port=$(cat "$port_file")
export npm_config_arch="$arch"
export pnpm_config_arch="$arch"
export npm_config_platform="$platform"
export pnpm_config_platform="$platform"
export pnpm_config_registry="http://127.0.0.1:${port}/"
export pnpm_config_trust_lockfile=true
export pnpm_config_pm_on_fail=ignore
export pnpm_config_side_effects_cache=false
export pnpm_config_update_notifier=false
export pnpm_config_minimum_release_age=0
export pnpm_config_package_import_method=clone-or-copy

set +e
pnpm install --frozen-lockfile --ignore-scripts --reporter append-only
status=$?
set -e
cleanup
exit "$status"
