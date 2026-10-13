<script setup lang="ts">
export type AccelerationCell = "ready" | "experimental" | "none"

export interface AccelerationRow {
  platform: string
  cells: AccelerationCell[]
}

defineProps<{
  title: string
  subtitle: string
  platformLabel: string
  backends: string[]
  rows: AccelerationRow[]
  legendReady: string
  legendExperimental: string
  legendNone: string
}>()

const cellLabel: Record<AccelerationCell, string> = {
  ready: "supported",
  experimental: "experimental",
  none: "not available"
}
</script>

<template>
  <section class="acceleration" aria-labelledby="acceleration-title">
    <h2 id="acceleration-title" class="section-title">{{ title }}</h2>
    <p class="acceleration-subtitle">{{ subtitle }}</p>

    <div class="matrix-wrap" role="region" :aria-label="title" tabindex="0">
      <table class="matrix">
        <thead>
          <tr>
            <th scope="col" class="platform-col">{{ platformLabel }}</th>
            <th v-for="backend in backends" :key="backend" scope="col">{{ backend }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.platform">
            <th scope="row">{{ row.platform }}</th>
            <td v-for="(cell, index) in row.cells" :key="`${row.platform}-${backends[index]}`">
              <span
                class="dot"
                :data-state="cell"
                :title="`${backends[index]}: ${cellLabel[cell]}`"
                :aria-label="`${backends[index]}: ${cellLabel[cell]}`"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul class="legend" aria-label="Legend">
      <li>
        <span class="dot" data-state="ready" aria-hidden="true" />
        {{ legendReady }}
      </li>
      <li>
        <span class="dot" data-state="experimental" aria-hidden="true" />
        {{ legendExperimental }}
      </li>
      <li>
        <span class="dot" data-state="none" aria-hidden="true" />
        {{ legendNone }}
      </li>
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

.acceleration {
  padding: 64px 0 24px;
  border-top: 1px solid var(--vp-c-divider);
}

.acceleration-subtitle {
  margin: 14px 0 0;
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.5;
}

.matrix-wrap {
  margin-top: 32px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.matrix {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  color: var(--vp-c-text-1);
  font-size: 14px;
  line-height: 1.4;
}

.matrix th,
.matrix td {
  padding: 14px 12px;
  text-align: center;
  vertical-align: middle;
  border-bottom: 1px solid var(--vp-c-divider);
}

.matrix thead th {
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  background: rgb(0 0 0 / 12%);
  white-space: nowrap;
}

.matrix .platform-col,
.matrix tbody th {
  text-align: left;
  padding-left: 18px;
  padding-right: 16px;
  white-space: nowrap;
}

.matrix tbody th {
  color: var(--vp-c-brand-1);
  font-weight: 600;
  font-size: 14px;
}

.matrix tbody tr:last-child th,
.matrix tbody tr:last-child td {
  border-bottom: 0;
}

.dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  vertical-align: middle;
}

.dot[data-state="ready"] {
  background: var(--heron-cyan-light, #9bdadd);
  box-shadow: 0 0 0 1px rgb(155 218 221 / 35%);
}

.dot[data-state="experimental"] {
  background: transparent;
  border: 1.5px solid var(--heron-cyan-light, #9bdadd);
}

.dot[data-state="none"] {
  background: transparent;
  border: 1.5px solid rgb(255 255 255 / 18%);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 22px;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
  color: var(--vp-c-text-3);
  font-size: 12px;
  line-height: 1.4;
}

.legend li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 600px) {
  .matrix th,
  .matrix td {
    padding: 12px 8px;
  }

  .matrix .platform-col,
  .matrix tbody th {
    padding-left: 14px;
    font-size: 13px;
  }

  .matrix thead th {
    font-size: 11px;
  }

  .dot {
    width: 10px;
    height: 10px;
  }
}
</style>
