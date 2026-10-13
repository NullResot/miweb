<script setup>
const tone = "green";
</script>
<template>
  <main>
    <h1>Vue 页面</h1>
    <button id="vue-target" :style="{ color: tone }">Vue button</button>
  </main>
</template>
<style scoped>
button {
  padding: 12px;
  border-radius: 8px;
}
</style>
