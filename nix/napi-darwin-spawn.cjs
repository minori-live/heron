// Nix on Darwin always installs a seatbelt profile, including when
// `sandbox = false` selects the allow-default profile. `/bin/ps` returns
// EPERM from that profile. `@napi-rs/cli` calls `execFile("/bin/ps")` while
// publishing the native addon and treats this synchronous throw as fatal.
// Node's own contract reports spawn failures through the callback.
const childProcess = require("node:child_process")

const execFile = childProcess.execFile

childProcess.execFile = function patchedExecFile(file, args, options, callback) {
  let normalizedArgs = args
  let normalizedOptions = options
  let normalizedCallback = callback
  if (typeof args === "function") {
    normalizedCallback = args
    normalizedArgs = []
    normalizedOptions = {}
  } else if (typeof options === "function") {
    normalizedCallback = options
    normalizedOptions = {}
  }

  try {
    return execFile.call(this, file, normalizedArgs, normalizedOptions, normalizedCallback)
  } catch (error) {
    if (error && error.code === "EPERM" && typeof normalizedCallback === "function") {
      process.nextTick(() => normalizedCallback(error, "", ""))
      return undefined
    }
    throw error
  }
}
