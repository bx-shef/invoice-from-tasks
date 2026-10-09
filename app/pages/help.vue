<script setup lang="ts">
// Справка (публичная документация docs/guide) и ИИ-чат по ней — в раскладке сайта toolsai
// (layouts/helpdesk.vue): шапка с поиском, слева меню страниц (B24DashboardSidebar: сворачивается
// до иконок, на узком экране — панелью), по центру статья на белом листе, справа оглавление и
// «Обсудить с ИИ». Страница выбирается `?p=<slug>`, раздел — хэшем. Открывается из меню приложения
// и слайдером по ссылке «Что это значит?» (HelpLink → app.vue → сюда). Чат — только во фрейме
// (модель платная). Стили — app/assets/css/help.css, всё под `.hd-shell`.
import type { KbPage } from '#shared/domain/kb'
import { FAQ_SLUG, renderHelp } from '~/utils/help'
import { faqItemsOf, previewOf, surroundOf, tocOf } from '~/utils/helpLayout'
import HomeIcon from '@bitrix24/b24icons-vue/outline/HomeIcon'
import RocketIcon from '@bitrix24/b24icons-vue/outline/RocketIcon'
import EditMIcon from '@bitrix24/b24icons-vue/outline/EditMIcon'
import MoneyIcon from '@bitrix24/b24icons-vue/outline/MoneyIcon'
import GlobeExtranetIcon from '@bitrix24/b24icons-vue/outline/GlobeExtranetIcon'
import GraphsDiagramIcon from '@bitrix24/b24icons-vue/outline/GraphsDiagramIcon'
import QuestionIcon from '@bitrix24/b24icons-vue/outline/QuestionIcon'
import KnowledgeBaseIcon from '@bitrix24/b24icons-vue/outline/KnowledgeBaseIcon'
import CopilotIcon from '@bitrix24/b24icons-vue/outline/CopilotIcon'
import '~/assets/css/help.css'

useHead({ title: 'Справка — Счёт из задач' })

const route = useRoute()
const router = useRouter()
const b24 = useB24()
const pages = ref<KbPage[]>([])
const loadError = ref('')
const inFrame = ref(false)
const { open: chatOpen, openChat, closeChat, discussPage } = useHelpChat()

// Без `?p` — главная справки (как в skills-site): плитки разделов, частые вопросы, «Спросить ИИ»
const slug = computed(() => String(route.query.p ?? ''))
const isHome = computed(() => !slug.value)
const page = computed(() => pages.value.find(p => p.slug === slug.value) ?? null)
const html = computed(() => (page.value ? renderHelp(page.value.markdown) : ''))
const toc = computed(() => (page.value ? tocOf(page.value.markdown) : []))
const preview = computed(() => previewOf(toc.value))
const surround = computed(() => surroundOf(pages.value, slug.value))
const isFaq = computed(() => slug.value === FAQ_SLUG)
const faqPage = computed(() => pages.value.find(p => p.slug === FAQ_SLUG) ?? null)
const faq = computed(() => (faqPage.value ? faqItemsOf(faqPage.value.markdown) : { intro: '', items: [] }))
const faqHtml = computed(() => faq.value.items.map(i => ({ ...i, html: renderHelp(i.answer) })))
/** Разделы на главной — всё, кроме FAQ (он идёт своим блоком ниже). */
const tiles = computed(() => pages.value.filter(p => p.slug !== FAQ_SLUG))

const ICONS: Record<string, typeof RocketIcon> = {
  '01-start': RocketIcon,
  '02-fill': EditMIcon,
  '03-rates': MoneyIcon,
  '04-public': GlobeExtranetIcon,
  '05-economics': GraphsDiagramIcon,
  '90-faq': QuestionIcon
}
const menuItems = computed(() => [{ label: 'Главная', icon: HomeIcon, to: { path: '/help' }, active: isHome.value }, ...pages.value.map(p => ({
  label: p.title,
  icon: ICONS[p.slug] ?? KnowledgeBaseIcon,
  to: { path: '/help', query: { p: p.slug } },
  active: p.slug === slug.value
}))])
const footerItems = computed(() => [{ label: 'Спросить ИИ', icon: CopilotIcon, onSelect: () => openChat() }])

const crumbs = computed(() => [
  { label: 'Справка', to: { path: '/help' } },
  { label: page.value?.title ?? '' }
])

/** Прокрутка к разделу из хэша — после отрисовки страницы; без хэша — к началу статьи. */
async function scrollToHash() {
  await nextTick()
  const id = route.hash.slice(1)
  const el = id ? document.getElementById(decodeURIComponent(id)) : null
  // Вопрос FAQ из «Что это значит?» — раскрыт сразу
  if (el instanceof HTMLDetailsElement) el.open = true
  if (el) el.scrollIntoView({ block: 'start' })
  else window.scrollTo({ top: 0 })
}

/** Ссылки справки вида `/help?p=…#…` — переходом внутри приложения, внешние — в новой вкладке. */
function onContentClick(e: MouseEvent) {
  const a = (e.target as HTMLElement | null)?.closest('a')
  const href = a?.getAttribute('href') ?? ''
  if (!a || !href) return
  if (href.startsWith('/help')) {
    e.preventDefault()
    void router.push(href)
  } else if (href.startsWith('#')) {
    e.preventDefault()
    void router.push({ path: '/help', query: { p: slug.value }, hash: href })
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
  <div
    class="hd-shell"
    :class="{ 'hd-shell--chat': chatOpen && inFrame }"
  >
    <B24DashboardGroup
      unit="px"
      storage="local"
      storage-key="help-menu"
      :b24ui="{ base: 'static block overflow-visible' }"
    >
      <header class="hd-header">
        <B24DashboardSidebarToggle
          color="air-tertiary"
          aria-label="Меню справки"
        />
        <NuxtLink
          :to="{ path: '/help', query: { p: pages[0]?.slug } }"
          class="hd-logo"
        >
          <span class="hd-logo-brand">Счёт из задач</span>
          <span class="hd-logo-word">Справка</span>
        </NuxtLink>
        <HelpSearch
          :pages="pages"
          :chat="inFrame"
          class="hd-header-search"
        />
        <B24Button
          v-if="inFrame"
          color="air-tertiary"
          :icon="CopilotIcon"
          :active="chatOpen"
          active-color="air-secondary-accent"
          title="Спросить ИИ"
          aria-label="Спросить ИИ"
          @click="chatOpen ? closeChat() : openChat()"
        />
      </header>

      <div class="hd-body">
        <B24DashboardSidebar
          id="help-menu"
          mode="slideover"
          collapsible
          :toggle="false"
          :default-size="260"
          :min-size="220"
          :max-size="300"
          :collapsed-size="64"
          class="hd-sidebar"
        >
          <template #default="{ collapsed }">
            <B24NavigationMenu
              orientation="vertical"
              :collapsed="collapsed"
              :items="menuItems"
              tooltip
              aria-label="Разделы справки"
            />
          </template>
          <template #footer="{ collapsed }">
            <div
              class="hd-menu-footer"
              :class="{ 'hd-menu-footer--collapsed': collapsed }"
            >
              <B24NavigationMenu
                v-if="inFrame"
                orientation="vertical"
                :collapsed="collapsed"
                :items="footerItems"
                tooltip
                class="hd-menu-footer-nav"
              />
              <B24DashboardSidebarCollapse :title="collapsed ? 'Развернуть меню' : 'Свернуть меню'" />
            </div>
          </template>
        </B24DashboardSidebar>

        <div class="hd-page">
          <div class="hd-article-layout">
            <div class="hd-article">
              <B24Alert
                v-if="loadError"
                color="air-primary-alert"
                title="Справка не загрузилась"
                :description="loadError"
                class="hd-alert"
              />
              <section
                v-if="isHome && pages.length"
                class="hd-home"
                data-testid="help-home"
              >
                <div class="hd-hero">
                  <div
                    class="hd-hero-glow"
                    aria-hidden="true"
                  />
                  <h1 class="hd-hero-title">
                    <span class="hd-hero-brand">Счёт из задач</span>
                    <span class="hd-hero-word">Справка</span>
                  </h1>
                  <p class="hd-hero-text">
                    Как заполнить счёт по задачам, задать ставки и показать клиенту расшифровку
                  </p>
                </div>

                <div class="hd-grid">
                  <NuxtLink
                    v-for="(t, i) in tiles"
                    :key="t.slug"
                    :to="{ path: '/help', query: { p: t.slug } }"
                    class="hd-tile"
                    :class="`hd-tone-${(i % 6) + 1}`"
                  >
                    <div class="hd-tile-cover">
                      <span class="hd-tile-badge"><component :is="ICONS[t.slug] ?? KnowledgeBaseIcon" /></span>
                      <component
                        :is="ICONS[t.slug] ?? KnowledgeBaseIcon"
                        class="hd-tile-mark"
                      />
                    </div>
                    <div class="hd-tile-body">
                      <h3 class="hd-tile-title">{{ t.title }}</h3>
                      <p class="hd-tile-text">{{ t.description }}</p>
                    </div>
                    <span
                      class="hd-tile-go"
                      aria-hidden="true"
                    >→</span>
                  </NuxtLink>
                </div>

                <h2 class="hd-section-title">
                  Частые вопросы
                </h2>
                <div class="hd-faq">
                  <details
                    v-for="item in faqHtml.slice(0, 5)"
                    :key="item.id"
                    class="hd-faq-item"
                  >
                    <summary>{{ item.q }}</summary>
                    <!-- eslint-disable vue/no-v-html -- markdown справки, сырой HTML выключен (renderHelp) -->
                    <div
                      class="hd-faq-answer hd-md"
                      @click="onContentClick"
                      v-html="item.html"
                    />
                    <!-- eslint-enable vue/no-v-html -->
                  </details>
                </div>
                <div class="hd-section-more">
                  <NuxtLink
                    :to="{ path: '/help', query: { p: FAQ_SLUG } }"
                    class="hd-btn-pill"
                  >
                    Все вопросы
                  </NuxtLink>
                </div>

                <div
                  v-if="inFrame"
                  class="hd-promo"
                >
                  <div>
                    <h3 class="hd-promo-title">
                      Не нашли ответ?
                    </h3>
                    <p class="hd-promo-text">
                      ИИ-помощник ответит по этой справке и даст ссылки на разделы
                    </p>
                  </div>
                  <B24Button
                    color="air-boost"
                    label="Спросить ИИ"
                    @click="openChat()"
                  />
                </div>
              </section>

              <article
                v-else-if="page"
                data-testid="help-page"
              >
                <div class="hd-article-head">
                  <B24Breadcrumb
                    :items="crumbs"
                    class="hd-breadcrumbs"
                    :b24ui="{ list: 'flex-nowrap min-w-0', item: 'min-w-0', link: 'min-w-0', linkLabel: 'truncate' }"
                  />
                </div>
                <div class="hd-article-title-wrap">
                  <h1>{{ page.title }}</h1>
                </div>
                <p
                  v-if="page.description"
                  class="hd-lead"
                >
                  {{ page.description }}
                </p>

                <div
                  v-if="preview.length > 1 && !isFaq"
                  class="hd-toc-preview"
                >
                  <p>В статье:</p>
                  <ul>
                    <li
                      v-for="l in preview"
                      :key="l.id"
                    >
                      <NuxtLink :to="{ path: '/help', query: { p: slug }, hash: `#${l.id}` }">
                        {{ l.text }}
                      </NuxtLink>
                    </li>
                  </ul>
                </div>

                <!-- eslint-disable vue/no-v-html -- markdown справки из репозитория, сырой HTML выключен (renderHelp) -->
                <div
                  v-if="isFaq"
                  class="hd-faq"
                  data-testid="help-faq"
                >
                  <details
                    v-for="item in faqHtml"
                    :id="item.id"
                    :key="item.id"
                    class="hd-faq-item"
                  >
                    <summary>{{ item.q }}</summary>
                    <div
                      class="hd-faq-answer hd-md"
                      @click="onContentClick"
                      v-html="item.html"
                    />
                  </details>
                </div>
                <div
                  v-else
                  class="hd-md"
                  @click="onContentClick"
                  v-html="html"
                />
                <!-- eslint-enable vue/no-v-html -->

                <nav
                  v-if="surround[0] || surround[1]"
                  class="hd-surround"
                  aria-label="Соседние страницы"
                >
                  <NuxtLink
                    v-if="surround[0]"
                    :to="{ path: '/help', query: { p: surround[0].slug } }"
                    class="hd-surround-link"
                  >
                    <span class="hd-surround-dir">← Назад</span>
                    <span>{{ surround[0].title }}</span>
                  </NuxtLink>
                  <span v-else />
                  <NuxtLink
                    v-if="surround[1]"
                    :to="{ path: '/help', query: { p: surround[1].slug } }"
                    class="hd-surround-link hd-surround-link--next"
                  >
                    <span class="hd-surround-dir">Дальше →</span>
                    <span>{{ surround[1].title }}</span>
                  </NuxtLink>
                </nav>
              </article>
            </div>
            <aside
              v-if="page && !isHome"
              class="hd-aside"
            >
              <HelpToc
                v-if="toc.length && !isFaq"
                :links="toc"
                :slug="slug"
              />
              <B24Button
                v-if="inFrame"
                color="air-boost"
                block
                class="hd-discuss"
                label="Обсудить с ИИ"
                data-testid="help-discuss"
                @click="discussPage(page.slug, page.title)"
              />
            </aside>
          </div>
        </div>
      </div>
    </B24DashboardGroup>

    <template v-if="inFrame">
      <HelpAskFloating />
      <HelpChat :page="page?.slug" />
    </template>
  </div>
</template>
