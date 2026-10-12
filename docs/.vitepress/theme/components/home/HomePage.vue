<script setup lang="ts">
import HomeDesk from "./HomeDesk.vue"
import HomeInstall from "./HomeInstall.vue"
import HomeValues from "./HomeValues.vue"
import ProductShowcase from "./ProductShowcase.vue"
import "./home.css"
</script>

<template>
  <main class="heron-home">
    <HomeDesk />
    <ProductShowcase />
    <HomeValues />
    <HomeInstall />
  </main>
</template>
