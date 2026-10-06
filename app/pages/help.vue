<script setup lang="ts">
// Справка (публичная документация docs/guide) и ИИ-чат по ней — по принципу toolsai. Страница
// выбирается `?p=<slug>`, раздел — хэшем. Открывается из меню приложения и слайдером по ссылке
// «Что это значит?» (HelpLink → app.vue → сюда). Чат — только во фрейме (модель платная).
import type { KbPage } from '#shared/domain/kb'
import { renderHelp } from '~/utils/help'

useHead({ title: 'Справка — Счёт из задач' })

const route = useRoute()
const router = useRouter()
const b24 = useB24()
const pages = ref<KbPage[]>([])
const loadError = ref('')
const inFrame = ref(false)

const slug = computed(() => String(route.query.p ?? '') || pages.value[0]?.slug || '')
const page = computed(() => pages.value.find(p => p.slug === slug.value) ?? null)
const html = computed(() => (page.value ? renderHelp(page.value.markdown) : ''))

/** Прокрутка к разделу из хэша — после отрисовки страницы. */
async function scrollToHash() {
  await nextTick()
  const id = route.hash.slice(1)
  if (id) document.getElementById(decodeURIComponent(id))?.scrollIntoView({ block: 'start' })
}

/** Ссылки справки вида `/help?p=…#…` — переходом внутри приложения, внешние — в новой вкладке. */
function onContentClick(e: MouseEvent) {
  const a = (e.target as HTMLElement | null)?.closest('a')
  const href = a?.getAttribute('href') ?? ''
  if (!a || !href) return
  if (href.startsWith('/help')) {
    e.preventDefault()
    void router.push(href)
  } else if (/^https?:/.test(href)) {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }
}

onMounted(async () => {
  inFrame.value = !!(await Promise.race([b24.init(), new Promise<undefined>(r => setTimeout(() => r(undefined), 3000))]))
  try {
    pages.value = (await $fetch<{ pages: KbPage[] }>('/api/kb/pages')).pages
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  }
  await scrollToHash()
})
watch(() => [route.query.p, route.hash], () => void scrollToHash())
</script>

<template>
  <div class="mx-auto max-w-5xl p-4 sm:p-6 grid gap-6 md:grid-cols-[14rem_1fr]">
    <nav
      class="space-y-1 text-sm"
      aria-label="Разделы справки"
    >
      <div class="font-semibold mb-2">
        Справка
      </div>
      <NuxtLink
        v-for="p in pages"
        :key="p.slug"
        :to="{ path: '/help', query: { p: p.slug } }"
        class="block rounded px-2 py-1 hover:bg-(--ui-color-bg-content-secondary)"
        :class="p.slug === slug ? 'font-medium bg-(--ui-color-bg-content-secondary)' : ''"
        data-testid="help-nav"
      >
        {{ p.title }}
      </NuxtLink>
    </nav>

    <main class="space-y-6 min-w-0">
      <B24Alert
        v-if="loadError"
        color="air-primary-alert"
        title="Справка не загрузилась"
        :description="loadError"
      />
      <article
        v-if="page"
        class="space-y-3"
        data-testid="help-page"
      >
        <h1 class="text-xl font-semibold">
          {{ page.title }}
        </h1>
        <p
          v-if="page.description"
          class="opacity-70"
        >
          {{ page.description }}
        </p>
        <!-- eslint-disable vue/no-v-html -- markdown справки из репозитория, сырой HTML выключен (renderHelp) -->
        <div

          class="help-md"
          @click="onContentClick"
          v-html="html"
        />
        <!-- eslint-enable vue/no-v-html -->
      </article>

      <HelpChat
        v-if="inFrame"
        :page="page?.slug"
      />
    </main>
  </div>
</template>

<style scoped>
.help-md :deep(h2) { font-size: 1.125rem; font-weight: 600; margin-top: 1.5rem; }
.help-md :deep(h3) { font-weight: 600; margin-top: 1rem; }
.help-md :deep(p), .help-md :deep(ul), .help-md :deep(ol) { margin-top: 0.5rem; }
.help-md :deep(ul) { list-style: disc; padding-left: 1.25rem; }
.help-md :deep(ol) { list-style: decimal; padding-left: 1.25rem; }
.help-md :deep(a) { text-decoration: underline; }
.help-md :deep(code) { font-family: ui-monospace, monospace; font-size: 0.9em; }
</style>
