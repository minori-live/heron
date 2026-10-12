<script setup lang="ts">
import { withBase } from "vitepress"
import AnalysisShowcase from "./AnalysisShowcase.vue"
import type { AnalysisCopy } from "./plugin-analysis-copy"

defineProps<{ copy: AnalysisCopy }>()

const comparisonImage = withBase("/daw/plugin-analysis-comparison.jpg")
const fitImage = withBase("/daw/plugin-analysis-eq-fit.jpg")
</script>

<template>
  <AnalysisShowcase
    :title="copy.comparisonTitle"
    :body="copy.comparisonBody"
    :image="comparisonImage"
    :image-width="2640"
    :image-height="1624"
    :enlarge="copy.enlarge"
  />
  <AnalysisShowcase
    :title="copy.fitTitle"
    :body="copy.fitBody"
    :image="fitImage"
    :image-width="1800"
    :image-height="1404"
    :enlarge="copy.enlarge"
    reverse
  />
  <section class="analysis-workflow" aria-labelledby="analysis-workflow-title">
    <h2 id="analysis-workflow-title" class="section-title">{{ copy.workflowTitle }}</h2>
    <ol class="workflow-steps">
      <li v-for="step in copy.steps" :key="step.title" class="workflow-step">
        <h3 class="step-title">{{ step.title }}</h3>
        <p class="step-body">{{ step.body }}</p>
      </li>
    </ol>
  </section>
  <section class="analysis-capabilities" aria-labelledby="analysis-capabilities-title">
    <h2 id="analysis-capabilities-title" class="section-title">{{ copy.detailsTitle }}</h2>
    <ul class="capability-list">
      <li v-for="detail in copy.details" :key="detail" class="capability">{{ detail }}</li>
    </ul>
  </section>
</template>

<style scoped>
.section-title {
  margin: 0;
  font-family: var(--heron-display);
  font-size: clamp(30px, 3.6vw, 44px);
  font-weight: 550;
  letter-spacing: -0.025em;
  line-height: 1.3;
}
.analysis-workflow {
  padding: 64px 0;
  border-top: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-divider);
}
.workflow-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 40px;
  margin: 40px 0 0;
  padding: 0;
  list-style: none;
  counter-reset: workflow;
}
.workflow-step {
  counter-increment: workflow;
}
.workflow-step::before {
  display: block;
  margin-bottom: 16px;
  color: var(--vp-c-brand-1);
  font-family: var(--heron-display);
  font-size: 32px;
  line-height: 1;
  content: counter(workflow, decimal-leading-zero);
}
.step-title {
  margin: 0 0 12px;
  font-size: 22px;
  font-weight: 550;
  line-height: 1.45;
}
.step-body {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.8;
}
.analysis-capabilities {
  padding: 80px 0;
}
.capability-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 72px;
  row-gap: 18px;
  margin: 36px 0 0;
  padding-left: 20px;
  list-style: disc;
}
.capability {
  padding-left: 6px;
  color: var(--vp-c-text-2);
  font-size: 16px;
  line-height: 1.7;
}
.capability::marker {
  color: var(--vp-c-brand-1);
}
@media (max-width: 700px) {
  .workflow-steps,
  .capability-list {
    grid-template-columns: 1fr;
    gap: 28px;
  }
  .analysis-workflow,
  .analysis-capabilities {
    padding: 56px 0;
  }
}
</style>
