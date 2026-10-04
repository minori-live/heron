<script setup lang="ts">
import { UiAnalysisPlot, type UiAnalysisSeries, type UiAnalysisHeatmap } from "@heron/ui"
defineProps<{
  title: string
  xLabel: string
  yLabel: string
  series: UiAnalysisSeries[]
  logarithmic?: boolean
  xDomain?: readonly [number, number]
  yDomain?: readonly [number, number]
  heatmap?: UiAnalysisHeatmap
  colorDomain?: readonly [number, number]
}>()
</script>
<template>
  <figure class="doctor-plot">
    <figcaption>
      <span class="plot-title">{{ title }}</span
      ><span class="legend"
        ><span
          v-for="(item, index) in series"
          :key="index"
          :style="{
            color: item.color ?? (index ? 'var(--ui-color-action)' : 'var(--ui-signal-mixer-input)')
          }"
          >{{ item.label }}</span
        ></span
      >
    </figcaption>
    <div class="plot-stage">
      <UiAnalysisPlot
        :label="title"
        :x-label="xLabel"
        :y-label="yLabel"
        :series="series"
        :logarithmic="logarithmic"
        :x-domain="xDomain"
        :y-domain="yDomain"
        :heatmap="heatmap"
        :color-domain="colorDomain"
      />
    </div>
  </figure>
</template>
<style scoped>
.doctor-plot {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  margin: 0;
  background: var(--ui-color-canvas-subtle);
}
figcaption {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  min-height: 40px;
  padding: 0 24px 0 64px;
}
.plot-title {
  font-size: var(--ui-type-size-control);
  color: var(--ui-color-text-muted);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}
.legend > span::before {
  content: "";
  display: inline-block;
  width: 12px;
  height: 2px;
  margin-right: 6px;
  background: currentColor;
  vertical-align: middle;
}
.plot-stage {
  flex: 1;
  min-height: 200px;
}
</style>
