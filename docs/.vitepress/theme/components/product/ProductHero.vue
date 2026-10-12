<script setup lang="ts">
defineProps<{
  name: string
  tagline: string
  introTitle: string
  intro: string
  included: string
  image: string
  imageAlt: string
  imageWidth: number
  imageHeight: number
  enlarge: string
  downloadHref: string
  downloadLabel: string
  manualHref: string
  manualLabel: string
}>()
</script>

<template>
  <section class="product-hero" aria-labelledby="product-name">
    <div class="product-banner">
      <slot name="background">
        <svg class="response-art" viewBox="0 0 1440 440" fill="none" aria-hidden="true">
          <path
            d="M0 330H1440M0 220H1440M0 110H1440M240 0V440M480 0V440M720 0V440M960 0V440M1200 0V440"
            stroke="currentColor"
            opacity=".07"
          />
          <path
            d="M-80 245C140 245 180 245 300 165S440 60 550 165S690 295 810 205S910 70 1030 190S1190 310 1320 185S1430 90 1510 100"
            stroke="#a98ade"
            stroke-width="2"
            opacity=".55"
          />
          <path
            d="M-80 245C200 245 390 245 490 250S590 395 735 380S855 180 1030 200S1200 205 1290 120S1400 75 1510 80"
            stroke="#72c3c7"
            stroke-width="2"
            opacity=".7"
          />
          <path
            d="M-80 245C190 245 320 180 425 200S600 355 755 330S915 145 1050 160S1190 230 1300 125S1435 85 1510 80"
            stroke="#e5d899"
            stroke-width="4"
          />
          <circle cx="425" cy="200" r="7" fill="#a98ade" stroke="#171a1f" stroke-width="3" />
          <circle cx="755" cy="330" r="7" fill="#72c3c7" stroke="#171a1f" stroke-width="3" />
          <circle cx="1300" cy="125" r="7" fill="#e5d899" stroke="#171a1f" stroke-width="3" />
        </svg>
      </slot>
      <div class="product-width product-heading">
        <h1 id="product-name" class="product-name">{{ name }}</h1>
        <p class="product-tagline">{{ tagline }}</p>
      </div>
    </div>

    <div class="product-width product-overview">
      <div class="product-copy">
        <h2 class="product-intro-title">{{ introTitle }}</h2>
        <p class="product-intro">{{ intro }}</p>
        <p class="product-included">{{ included }}</p>
      </div>
      <div class="product-preview">
        <a
          class="product-image-link"
          :href="image"
          :aria-label="enlarge"
          target="_blank"
          rel="noreferrer"
        >
          <img
            class="product-image"
            :src="image"
            :alt="imageAlt"
            :width="imageWidth"
            :height="imageHeight"
            fetchpriority="high"
          />
        </a>
        <div class="product-actions">
          <a class="product-button product-button-primary" :href="downloadHref">{{
            downloadLabel
          }}</a>
          <a class="product-button product-button-secondary" :href="manualHref">{{
            manualLabel
          }}</a>
        </div>
        <slot name="support" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.product-width {
  width: min(1180px, calc(100% - 80px));
  margin: 0 auto;
}

.product-banner {
  position: relative;
  overflow: hidden;
  padding: 228px 0 58px;
  color: #eef0f2;
  background: #171a1f;
}

.response-art {
  position: absolute;
  top: -64px;
  left: 0;
  width: 100%;
  min-width: 1000px;
  height: 410px;
  opacity: 0.75;
  mask-image: linear-gradient(#000 45%, transparent 96%);
}

.product-heading {
  position: relative;
}

.product-name {
  max-width: var(--product-name-width, none);
  margin: 0;
  font-family: "Barlow Condensed", var(--vp-font-family-base);
  font-size: var(--product-name-size, clamp(68px, 8vw, 108px));
  font-weight: 550;
  letter-spacing: -0.035em;
  line-height: 1;
}

.product-tagline {
  max-width: 460px;
  margin: 18px 0 0;
  color: #e5d899;
  font-size: clamp(20px, 2vw, 26px);
  line-height: 1.5;
}

.product-overview {
  display: grid;
  grid-template-columns: 0.85fr 1.15fr;
  align-items: start;
  gap: 64px;
  padding-bottom: 80px;
}

.product-copy {
  padding-top: 44px;
}

.product-intro-title {
  margin: 0 0 20px;
  font-family: var(--heron-display);
  font-size: clamp(28px, 3vw, 36px);
  font-weight: 550;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.product-intro {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 17px;
  line-height: 1.85;
}

.product-included {
  margin: 24px 0 0;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.7;
}

.product-preview {
  position: relative;
  margin-top: -182px;
}

.product-image-link {
  display: block;
  overflow: hidden;
  border: 1px solid #48494c;
  border-radius: 9px;
  box-shadow: 0 16px 36px #0003;
}

.product-image {
  display: block;
  width: 100%;
  height: auto;
}

.product-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin: 30px 0 24px;
}

.product-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 10px 24px;
  border: 1px solid transparent;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.product-button-primary {
  color: var(--vp-c-bg);
  background: var(--vp-c-brand-1);
}

.product-button-secondary {
  border-color: var(--vp-c-border);
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-elv);
}

.product-button:hover {
  border-color: var(--vp-c-text-2);
}

.product-button:focus-visible,
.product-image-link:focus-visible {
  outline: 3px solid var(--vp-c-brand-1);
  outline-offset: 5px;
}

@media (max-width: 900px) {
  .product-width {
    width: calc(100% - 48px);
  }
  .product-banner {
    padding: 180px 0 46px;
  }
  .product-overview {
    grid-template-columns: 1fr;
    gap: 32px;
    padding-bottom: 56px;
  }
  .product-preview {
    margin-top: 0;
    grid-row: 1;
    padding-top: 32px;
  }
  .product-copy {
    max-width: 680px;
    padding-top: 0;
  }
  .product-heading {
    max-width: none;
  }
  .product-name {
    max-width: none;
  }
  .product-tagline {
    max-width: none;
  }
}

@media (max-width: 540px) {
  .product-width {
    width: calc(100% - 40px);
  }
  .product-banner {
    padding: 132px 0 32px;
  }
  .response-art {
    left: -210px;
    top: -120px;
  }
  .product-actions {
    gap: 10px;
    margin-top: 24px;
  }
  .product-button {
    flex: 1;
    padding-inline: 16px;
  }
  .product-intro {
    font-size: 16px;
  }
}
</style>
