<script setup lang="ts">
import { onMounted, onBeforeUnmount, onServerPrefetch, shallowRef } from 'vue'
import { useData } from 'vitepress'
import { createElement } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import WebsiteHome from '../../../../src/WebsiteHome'
import '../../../../src/dark-gallery.css?website'
import './marketing.css'

const { site } = useData()
const container = shallowRef<HTMLElement>()
const element = createElement(WebsiteHome, { base: site.value.base })
// Prerender the actual homepage, then hydrate the same React animation components.
const markup = shallowRef(import.meta.env.SSR ? '' : document.getElementById('marketing-react')?.innerHTML || '')
if (import.meta.env.SSR) onServerPrefetch(async () => {
  const { renderToString } = await import('react-dom/server')
  markup.value = renderToString(element)
})
let root: Root | undefined
onMounted(() => {
  if (!container.value) return
  if (container.value.hasChildNodes()) root = hydrateRoot(container.value, element)
  else { root = createRoot(container.value); root.render(element) }
})
onBeforeUnmount(() => { root?.unmount() })
</script>

<template><div id="marketing-react" ref="container" v-html="markup" /></template>
