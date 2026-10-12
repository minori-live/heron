<script setup lang="ts">
import PlatformIcon from "../product/PlatformIcon.vue"

defineProps<{
  href: string
  title: string
  detail: string
  /** File name and size once the latest release has been resolved. */
  file?: string
  platform: "macOS" | "Windows" | "Linux"
  action: string
  primary?: boolean
}>()
</script>

<template>
  <a class="download" :class="{ 'download--primary': primary }" :href="href">
    <span class="download__icon" aria-hidden="true"><PlatformIcon :name="platform" /></span>
    <span class="download__text">
      <span class="download__title">{{ title }}</span>
      <span class="download__detail">{{ detail }}</span>
      <span class="download__file" :class="{ 'is-pending': !file }">{{ file ?? " " }}</span>
    </span>
    <span class="download__action">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />
      </svg>
      <span class="download__action-label">{{ action }}</span>
    </span>
  </a>
</template>

<style scoped>
.download {
  position: relative;
  display: flex;
  overflow: hidden;
  align-items: center;
  gap: 16px;
  padding: 16px 16px 16px 18px;
  border: 1px solid var(--home-edge);
  border-radius: 20px;
  color: var(--home-ink);
  background: var(--home-panel);
  text-decoration: none;
  backdrop-filter: blur(18px);
  transition:
    transform 200ms var(--home-ease),
    border-color 200ms ease,
    box-shadow 200ms ease;
}

.download:hover {
  border-color: color-mix(in srgb, var(--home-violet) 45%, var(--home-edge));
  box-shadow: 0 16px 36px -20px var(--home-shadow);
  transform: translateY(-2px);
}

.download:focus-visible {
  outline: 2px solid var(--home-violet);
  outline-offset: 3px;
}

.download--primary {
  padding: 22px 22px 22px 24px;
  border-color: color-mix(in srgb, var(--home-violet) 30%, var(--home-edge));
  background:
    radial-gradient(120% 140% at 0% 0%, rgb(63 191 196 / 16%), transparent 55%),
    radial-gradient(120% 140% at 100% 100%, rgb(169 138 222 / 18%), transparent 55%),
    var(--home-panel);
}

.download__icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: none;
  place-items: center;
  border-radius: 14px;
  color: var(--home-ink);
  background: var(--home-fill);
  font-size: 20px;
}

.download--primary .download__icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--home-window-solid);
  box-shadow: 0 6px 18px -8px var(--home-shadow);
  font-size: 26px;
}

.download__text {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 2px;
}

.download__title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.download--primary .download__title {
  font-size: 19px;
}

.download__detail {
  color: var(--home-ink-2);
  font-size: 14px;
}

.download__file {
  overflow: hidden;
  margin-top: 4px;
  color: var(--home-ink-2);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
  transition: opacity 300ms ease;
}

.download__file.is-pending {
  opacity: 0;
}

.download__action {
  display: inline-flex;
  height: 40px;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 40px;
  padding: 0 12px;
  border-radius: 20px;
  color: var(--home-ink);
  background: var(--home-fill);
  font-size: 14px;
  font-weight: 650;
  transition: background 200ms ease;
}

.download--primary .download__action {
  height: 46px;
  padding: 0 22px 0 18px;
  border-radius: 23px;
  color: var(--vp-c-bg);
  background: var(--home-ink);
  font-size: 15px;
}

.download:not(.download--primary) .download__action-label {
  display: none;
}

.download__action svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  transition: transform 200ms var(--home-ease);
}

.download:hover .download__action svg {
  transform: translateY(2px);
}

@media (max-width: 560px) {
  .download--primary {
    flex-wrap: wrap;
    padding: 18px;
  }

  .download--primary .download__action {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .download,
  .download__action svg {
    transition: none;
  }
}
</style>
