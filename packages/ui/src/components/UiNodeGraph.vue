<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from "vue"
import type { UiGraphEdge, UiGraphNode } from "../types"

const props = withDefaults(
  defineProps<{
    nodes: readonly UiGraphNode[]
    edges: readonly UiGraphEdge[]
    label: string
    resetToken?: number
    interactive?: boolean
  }>(),
  { resetToken: 0, interactive: true }
)
const emit = defineEmits<{ selectNode: [id: string] }>()
const host = useTemplateRef<HTMLDivElement>("host")
const chart = shallowRef<import("echarts/core").ECharts>()
let resizeObserver: ResizeObserver | undefined

const tones = {
  neutral: "var(--ui-color-surface-active)",
  info: "var(--ui-color-action)",
  warning: "var(--ui-color-warning)",
  danger: "var(--ui-color-danger)"
} as const

async function render(): Promise<void> {
  if (!host.value) return
  const [{ init, use }, { GraphChart }, { TooltipComponent }, { CanvasRenderer }] =
    await Promise.all([
      import("echarts/core"),
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/renderers")
    ])
  if (!host.value) return
  use([GraphChart, TooltipComponent, CanvasRenderer])
  chart.value?.dispose()
  chart.value = init(host.value)
  chart.value.setOption({
    animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      formatter: (value: { data?: { detail?: string } }) => value.data?.detail ?? ""
    },
    series: [
      {
        type: "graph",
        layout: "none",
        roam: props.interactive,
        symbol: "roundRect",
        symbolSize: 54,
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: 7,
        label: {
          show: true,
          position: "bottom",
          color: "var(--ui-color-text)",
          width: 150,
          overflow: "truncate"
        },
        emphasis: { focus: "adjacency" },
        data: props.nodes.map((node) => ({
          id: node.id,
          name: node.label,
          x: node.x,
          y: node.y,
          detail: node.detail,
          itemStyle: { color: tones[node.tone ?? "neutral"], opacity: node.disabled ? 0.45 : 1 }
        })),
        links: props.edges.map((edge) => ({
          id: edge.id,
          source: edge.from,
          target: edge.to,
          lineStyle: {
            color: tones[edge.tone ?? "neutral"],
            type: edge.tone === "warning" ? "dashed" : "solid"
          }
        }))
      }
    ]
  })
  chart.value.on("click", (event) => {
    const data = event.data as { id?: string } | null | undefined
    const id = event.dataType === "node" ? data?.id : undefined
    if (id) emit("selectNode", id)
  })
}

watch(
  () => [props.nodes, props.edges] as const,
  () => void render(),
  { deep: true }
)
watch(
  () => props.resetToken,
  () => chart.value?.dispatchAction({ type: "restore" })
)
onMounted(() => {
  void render()
  resizeObserver = new ResizeObserver(() => chart.value?.resize())
  if (host.value) resizeObserver.observe(host.value)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart.value?.dispose()
})
</script>

<template><div ref="host" class="ui-node-graph" role="img" :aria-label="props.label" /></template>

<style scoped>
.ui-node-graph {
  width: 100%;
  min-height: 32rem;
  background:
    linear-gradient(
      color-mix(in srgb, var(--ui-color-border) 30%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--ui-color-border) 30%, transparent) 1px,
      transparent 1px
    ),
    var(--ui-color-surface);
  background-size: 22px 22px;
}
</style>
