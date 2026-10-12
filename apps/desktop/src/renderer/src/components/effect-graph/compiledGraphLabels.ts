import type { CompiledAudioGraphNode } from "@heron/contracts"
import { t } from "../../i18n"

// Native graph diagnostics use fixed English labels. Keep their wire representation
// intact and translate only engine-owned presentation, retaining opaque identifiers.
const nativeLabels = new Map<string, string>([
  ["Hardware input", "effectGraph.chart.kinds.hardware-input"],
  ["Application input", "effectGraph.chart.kinds.application-input"],
  ["BUS input", "effectGraph.chart.kinds.bus-input"],
  ["Timeline input", "effectGraph.chart.kinds.timeline-input"],
  ["Instrument input", "effectGraph.chart.kinds.instrument-input"],
  ["Main-input PDC", "effectGraph.chart.labels.mainPdc"],
  ["Channel PDC", "effectGraph.chart.labels.channelPdc"],
  ["Send PDC", "effectGraph.chart.labels.sendPdc"],
  ["Bypass compensation", "effectGraph.chart.labels.bypassPdc"],
  ["Plug-in latency", "effectGraph.chart.labels.pluginLatency"],
  ["Stereo \u2192 Mono", "effectGraph.chart.labels.toMono"],
  ["Mono \u2192 Stereo", "effectGraph.chart.labels.toStereo"],
  ["Instrument", "effectGraph.chart.labels.instrument"],
  ["Insert effect", "effectGraph.chart.labels.insert"],
  ["Send (Pre)", "effectGraph.chart.labels.sendPre"],
  ["Send (Post)", "effectGraph.chart.labels.sendPost"],
  ["Send (PostPan)", "effectGraph.chart.labels.sendPostPan"]
])

export function compiledGraphNodeLabel(node: CompiledAudioGraphNode): string {
  if (["channel", "master", "hardware-output"].includes(node.kind)) return node.label
  const sidechainPrefix = "Side-chain PDC · "
  if (node.kind === "pdc-delay" && node.label.startsWith(sidechainPrefix)) {
    return t("effectGraph.chart.labels.sidechainPdc", {
      port: node.label.slice(sidechainPrefix.length)
    })
  }
  const key = nativeLabels.get(node.label)
  return key ? t(key) : node.label
}
