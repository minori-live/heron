<script setup lang="ts">
import { computed } from "vue"
import { withBase } from "vitepress"

const props = withDefaults(defineProps<{ locale?: "en" | "zh" }>(), { locale: "en" })
const copy = computed(() =>
  props.locale === "zh"
    ? {
        title: "Heron Studio 已内置 Heron EQ",
        body: "直接下载 Heron Studio，即可在工程中使用 Heron EQ，无需另行安装插件。",
        download: "下载 Heron Studio"
      }
    : {
        title: "Heron Studio includes Heron EQ",
        body: "Download Heron Studio to use Heron EQ in your projects. No separate plug-in installation is needed.",
        download: "Download Heron Studio"
      }
)
</script>

<template>
  <aside class="studio-included" :aria-label="copy.title">
    <img class="studio-logo" :src="withBase('/logo.png')" alt="" width="48" height="48" />
    <div class="studio-copy">
      <h3 class="studio-title">{{ copy.title }}</h3>
      <p class="studio-body">{{ copy.body }}</p>
    </div>
    <a class="studio-download" href="https://github.com/minori-live/heron/releases">
      {{ copy.download }}
    </a>
  </aside>
</template>

<style scoped>
.studio-included {
  display: flex;
  align-items: center;
  gap: 24px;
  margin: 32px 0;
  padding: 28px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}
.studio-logo {
  flex-shrink: 0;
  border: 0;
  border-radius: 0;
}
.studio-copy {
  flex: 1;
}
.studio-title {
  margin: 0;
  font-family: var(--vp-font-family-base);
  font-size: 19px;
  font-weight: 600;
  line-height: 1.5;
}
.studio-body {
  margin: 8px 0 0;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.8;
}
.studio-download {
  flex-shrink: 0;
  padding: 12px 20px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 24px;
  color: var(--vp-c-brand-1);
  font-size: 14px;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
}
.studio-download:hover {
  background: var(--vp-c-brand-soft);
}
.studio-download:focus-visible {
  outline: 3px solid var(--vp-c-brand-1);
  outline-offset: 4px;
}
@media (max-width: 1100px) {
  .studio-included {
    flex-wrap: wrap;
  }
  .studio-copy {
    flex-basis: calc(100% - 72px);
  }
  .studio-download {
    margin-left: 72px;
  }
}
@media (max-width: 540px) {
  .studio-included {
    padding: 24px;
    gap: 16px;
  }
  .studio-copy {
    flex-basis: 100%;
  }
  .studio-download {
    margin-left: 0;
  }
}
</style>
