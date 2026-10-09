#!/usr/bin/env bash
# Phase timing helper for the CI coverage tasks; see scripts/ci-timing.ts.
#
# The task shell runs the phase command unchanged, so quoting, PATH resolution,
# and exit-status propagation stay exactly as the task itself would run them.
# This helper only snapshots the sccache counters around the command and appends
# the step-summary row afterwards.
timed() {
  local label="$1"
  shift
  local state status
  state="$(node scripts/ci-timing.ts snapshot)"
  status=0
  "$@" || status=$?
  if [[ -n "$state" ]]; then
    node scripts/ci-timing.ts record "$label" "$state" "$status"
  fi
  return "$status"
}
