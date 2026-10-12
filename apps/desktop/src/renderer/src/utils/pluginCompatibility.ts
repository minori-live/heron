import { t } from "../i18n"

// Cached scanner reports retain their original diagnostics. Translate known Heron
// fallback copy at presentation time; preserve unknown vendor/native details.
const reasonKeys: Readonly<Record<string, string>> = {
  "Native VST3 factory enumeration is required for this module":
    "plugins.compatibility.factoryEnumeration",
  "Plugin initialization failed": "plugins.compatibility.initialization",
  "Plugin does not support 32-bit floating-point processing":
    "plugins.compatibility.floatProcessing",
  "Instrument requires an event input and a mono or stereo main output":
    "plugins.compatibility.instrumentEvents",
  "Effect requires a supported mono/stereo main input and output layout":
    "plugins.compatibility.effectLayout",
  "Instrument requires no main audio input and one supported main output":
    "plugins.compatibility.instrumentLayout",
  "Effect requires one supported main input and output; auxiliary inputs are supported":
    "plugins.compatibility.effectBuses",
  "Built-in VST3 probe failed": "plugins.compatibility.builtinProbe",
  "Bundled plug-in is absent from the installed suite": "plugins.compatibility.missingBuiltin",
  "Deep plug-in capability probe failed": "plugins.compatibility.capabilityProbe",
  "AudioPlugin discovery failed": "plugins.compatibility.discovery"
}

export function pluginCompatibilityMessage(reason: string | null | undefined): string {
  if (!reason) return t("mixer.pluginPicker.unavailable")
  const key = Object.hasOwn(reasonKeys, reason) ? reasonKeys[reason] : undefined
  return key ? t(key) : reason
}
