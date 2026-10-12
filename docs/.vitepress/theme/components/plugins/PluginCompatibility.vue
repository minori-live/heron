<script setup lang="ts">
import { computed } from "vue"
import PlatformIcon from "../product/PlatformIcon.vue"

const platforms = [
  { name: "Windows", formats: "VST3" },
  { name: "macOS", formats: "VST3 + AU" },
  { name: "Linux", formats: "VST3" }
] as const

const props = withDefaults(
  defineProps<{
    locale?: "en" | "zh"
    compact?: boolean
  }>(),
  { locale: "en", compact: false }
)

const label = computed(() =>
  props.locale === "zh" ? "支持的平台与插件格式" : "Supported platforms and plug-in formats"
)
</script>

<template>
  <dl
    class="plugin-compatibility"
    :class="{ 'plugin-compatibility--compact': compact }"
    :aria-label="label"
  >
    <div v-for="platform in platforms" :key="platform.name" class="compatibility-platform">
      <dt class="compatibility-name">
        <PlatformIcon class="compatibility-icon" :name="platform.name" />
        {{ platform.name }}
      </dt>
      <dd class="compatibility-formats">
        {{ platform.formats }}
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.plugin-compatibility {
  display: flex;
  flex-wrap: wrap;
  gap: 20px 40px;
  margin: 28px 0;
  padding: 0;
  color: inherit;
  font-family: var(--vp-font-family-base);
  line-height: 1.5;
}

.compatibility-platform {
  display: grid;
  gap: 4px;
}

.compatibility-name {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
}

.compatibility-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.compatibility-formats {
  margin: 0 0 0 32px;
  font-size: 13px;
}

.plugin-compatibility--compact {
  gap: 12px 28px;
  margin: 0;
}

.plugin-compatibility--compact .compatibility-platform {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.plugin-compatibility--compact .compatibility-name {
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

.plugin-compatibility--compact .compatibility-icon {
  width: 17px;
  height: 17px;
}

.plugin-compatibility--compact .compatibility-formats {
  margin: 0;
  font-size: 12px;
}
</style>
