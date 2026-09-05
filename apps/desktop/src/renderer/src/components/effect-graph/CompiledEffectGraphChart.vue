<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import type { CompiledAudioGraphSnapshot } from "@heron/contracts"
import { UiNodeGraph, type UiGraphEdge, type UiGraphNode } from "@heron/ui"
import { layoutCompiledEffectGraph } from "./compiledEffectGraphLayout"

const props = defineProps<{ snapshot: CompiledAudioGraphSnapshot; resetToken: number }>()
const { t } = useI18n()
const layout = computed(() => layoutCompiledEffectGraph(props.snapshot))
const nodes = computed<readonly UiGraphNode[]>(() =>
  layout.value.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    x: node.x,
    y: node.y,
    tone:
      node.pluginState === "bypassed" || node.pluginState === "unavailable"
        ? "neutral"
        : node.lowLatencyBypassed || node.kind === "pdc-delay"
          ? "warning"
          : node.kind === "effect" || node.latencySensitive
            ? "info"
            : "neutral",
    disabled: node.pluginState === "unavailable",
    detail: [
      node.label,
      node.kind.replaceAll("-", " "),
      node.pluginState ? t("effectGraph.chart.tooltip.state", { state: node.pluginState }) : "",
      node.latencySensitive ? t("effectGraph.chart.tooltip.latencySensitive") : "",
      node.lowLatencyBypassed ? t("effectGraph.chart.tooltip.lowLatencyBypassed") : "",
      node.latencySamples > 0
        ? t("effectGraph.chart.tooltip.latency", { samples: node.latencySamples })
        : "",
      t("effectGraph.chart.tooltip.signal", { width: node.signalWidth })
    ]
      .filter(Boolean)
      .join(" · ")
  }))
)
const edges = computed<readonly UiGraphEdge[]>(() =>
  layout.value.edges.map((edge) => ({
    id: edge.id,
    from: edge.source,
    to: edge.target,
    tone: edge.kind === "send-route" ? "warning" : "info"
  }))
)
</script>

<template>
  <UiNodeGraph
    class="compiled-effect-graph-chart"
    :nodes="nodes"
    :edges="edges"
    :reset-token="resetToken"
    :label="t('effectGraph.chart.ariaLabel')"
  />
</template>

<style scoped>
.compiled-effect-graph-chart {
  min-height: 520px;
}
</style>
