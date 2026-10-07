<script setup lang="ts">
import { UiAnalysisPlot, type UiAnalysisSeries, type UiAnalysisHeatmap } from "@heron/ui"
import {
  pluginAnalysisAxisLabel,
  pluginAnalysisMinimumSteps,
  type PluginAnalysisAxisUnit
} from "./pluginAnalysisAxes"
withDefaults(
  defineProps<{
    title: string
    xLabel: string
    yLabel: string
    xUnit: PluginAnalysisAxisUnit
    yUnit: PluginAnalysisAxisUnit
    series: UiAnalysisSeries[]
    logarithmic?: boolean
    smooth?: boolean
    xDomain?: readonly [number, number]
    yDomain?: readonly [number, number]
    heatmap?: UiAnalysisHeatmap
    colorDomain?: readonly [number, number]
  }>(),
  {
    smooth: true,
    logarithmic: false,
    xDomain: undefined,
    yDomain: undefined,
    heatmap: undefined,
    colorDomain: undefined
  }
)
</script>
<template>
  <figure class="plugin-analysis-plot">
    <figcaption>
      <span class="plot-title">{{ title }}</span
      ><span class="legend"
        ><span
          v-for="(item, index) in series"
          :key="index"
          :class="{ dashed: item.dashed }"
          :style="{
            '--analysis-series-color':
              item.color ?? (index ? 'var(--ui-color-action)' : 'var(--ui-signal-mixer-input)')
          }"
          >{{ item.label }}</span
        ></span
      >
    </figcaption>
    <div class="plot-stage">
      <UiAnalysisPlot
        :label="title"
        :x-label="pluginAnalysisAxisLabel(xLabel, xUnit)"
        :y-label="pluginAnalysisAxisLabel(yLabel, yUnit)"
        :x-unit="xUnit"
        :y-unit="yUnit"
        :x-minimum-step="pluginAnalysisMinimumSteps[xUnit]"
        :y-minimum-step="pluginAnalysisMinimumSteps[yUnit]"
        :series="series"
        :logarithmic="logarithmic"
        :smooth="smooth"
        :x-domain="xDomain"
        :y-domain="yDomain"
        :heatmap="heatmap"
        :color-domain="colorDomain"
      />
      <div v-if="$slots.overlay" class="plot-overlay"><slot name="overlay" /></div>
    </div>
  </figure>
</template>
<style scoped>
.plugin-analysis-plot {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  margin: 0;
  background: var(--ui-color-canvas-subtle);
}
figcaption {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 16px;
  min-height: 40px;
  padding: 8px 24px 0 64px;
}
.plot-title {
  color: var(--ui-color-text);
  font-size: var(--ui-type-size-panel-title);
  font-weight: var(--ui-type-weight-medium);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  color: var(--ui-color-text-muted);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}
.legend > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend > span::before {
  content: "";
  width: 14px;
  border-top: 2px solid var(--analysis-series-color);
}
.legend > span.dashed::before {
  border-top-style: dashed;
}
.plot-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 200px;
  overflow: hidden;
}
.plot-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}
</style>
