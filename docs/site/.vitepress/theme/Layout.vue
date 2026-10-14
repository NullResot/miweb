<script setup lang="ts">
import { useData } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import MarketingHome from './MarketingHome.vue'
const { frontmatter } = useData()
</script>

<template>
  <MarketingHome v-if="frontmatter.layout === 'marketing'" />
  <DefaultTheme.Layout v-else />
</template>
