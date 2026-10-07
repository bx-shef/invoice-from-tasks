<script setup lang="ts">
// Оглавление справа «В этой статье» (как HdToc в toolsai): серая линия слева, текущий раздел —
// тёмный с тёмной чертой; текущий раздел отслеживается по прокрутке.
import type { TocLink } from '~/utils/helpLayout'

const props = defineProps<{ links: TocLink[], slug: string }>()
const active = ref('')
let observer: IntersectionObserver | undefined

function observe() {
  observer?.disconnect()
  active.value = props.links[0]?.id ?? ''
  if (typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => {
    const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
    if (top) active.value = top.target.id
  }, { rootMargin: '-60px 0px -70% 0px' })
  for (const l of props.links) {
    const el = document.getElementById(l.id)
    if (el) observer.observe(el)
  }
}
onMounted(observe)
watch(() => props.links, () => void nextTick(observe))
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <nav
    class="hd-toc"
    aria-label="Оглавление статьи"
  >
    <p class="hd-toc-title">
      В этой статье
    </p>
    <ul class="hd-toc-list">
      <li
        v-for="l in links"
        :key="l.id"
        :class="`hd-toc-depth-${l.depth}`"
      >
        <NuxtLink
          :to="{ path: '/help', query: { p: slug }, hash: `#${l.id}` }"
          class="hd-toc-link"
          :class="{ 'is-active': l.id === active }"
        >
          {{ l.text }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
