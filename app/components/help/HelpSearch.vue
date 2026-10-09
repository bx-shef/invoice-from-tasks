<script setup lang="ts">
// Поиск по справке в шапке (как HdSearch в toolsai): ищет по заголовкам и тексту разделов всех
// страниц (searchHelp), выбор результата — переход к разделу. Enter и «Спросить ИИ» — вопрос
// ИИ-помощнику (только во фрейме: модель платная); вне фрейма Enter открывает первый результат.
import type { KbPage } from '#shared/domain/kb'
import { helpHref, searchHelp, searchSectionsOf } from '~/utils/helpLayout'

const props = defineProps<{ pages: KbPage[], chat?: boolean }>()
const router = useRouter()
const { openChat } = useHelpChat()

const query = ref('')
const open = ref(false)
const root = ref<HTMLElement | null>(null)

const sections = computed(() => searchSectionsOf(props.pages))
const results = computed(() => searchHelp(sections.value, query.value))

function close() {
  open.value = false
  query.value = ''
}
function go(slug: string, anchor: string) {
  void router.push(helpHref(slug, anchor))
  close()
}
function submit() {
  const q = query.value.trim()
  if (q.length < 2) return
  if (props.chat) {
    openChat(q)
    close()
  } else if (results.value[0]) {
    go(results.value[0].slug, results.value[0].anchor)
  }
}
function onDocumentClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <div
    ref="root"
    class="hd-search-wrap"
    @keydown.escape="close"
  >
    <B24Input
      v-model="query"
      class="hd-search-input"
      type="search"
      placeholder="Поиск по справке"
      aria-label="Поиск по справке"
      autocomplete="off"
      data-testid="help-search"
      @focus="open = true"
      @keydown.enter.prevent="submit"
    />
    <div
      v-if="open && query.trim().length >= 2"
      class="hd-search-results"
    >
      <button
        v-for="r in results"
        :key="`${r.slug}#${r.anchor}`"
        type="button"
        class="hd-search-item"
        data-testid="help-search-result"
        @click="go(r.slug, r.anchor)"
      >
        <span class="hd-search-item-title">{{ r.title }}</span>
        <span
          v-if="r.crumb"
          class="hd-search-item-crumb"
        >{{ r.crumb }}</span>
      </button>
      <p
        v-if="!results.length"
        class="hd-search-empty"
      >
        Ничего не нашлось
      </p>
      <button
        v-if="chat"
        type="button"
        class="hd-search-item hd-search-ask"
        @click="submit"
      >
        Спросить ИИ: «{{ query.trim() }}»
      </button>
    </div>
  </div>
</template>
