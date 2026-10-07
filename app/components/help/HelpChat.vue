<script setup lang="ts">
// ИИ-чат справки: вопрос → /api/kb/chat (BitrixGPT по фрагментам публичной справки) → ответ со
// ссылками на разделы. История — в памяти страницы; в localStorage — только раскрыт ли чат.
import { renderHelp } from '~/utils/help'

const props = defineProps<{ page?: string }>()
const api = useApi()
const router = useRouter()

interface Turn { role: 'user' | 'assistant', content: string, sources?: Array<{ title: string, url: string }> }
const turns = ref<Turn[]>([])
const question = ref('')
const busy = ref(false)
const error = ref('')

async function ask() {
  const q = question.value.trim()
  if (!q || busy.value) return
  turns.value.push({ role: 'user', content: q })
  question.value = ''
  busy.value = true
  error.value = ''
  try {
    const res = await api.post<{ answer: string, sources: Turn['sources'] }>('/api/kb/chat', {
      messages: turns.value.map(t => ({ role: t.role, content: t.content })),
      page: props.page
    })
    turns.value.push({ role: 'assistant', content: res.answer || 'Пустой ответ.', sources: res.sources })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    turns.value.pop()
    question.value = q
  } finally {
    busy.value = false
  }
}

/** Ссылки ответа на справку — переходом внутри приложения. */
function onClick(e: MouseEvent) {
  const a = (e.target as HTMLElement | null)?.closest('a')
  const href = a?.getAttribute('href') ?? ''
  if (a && href.startsWith('/help')) {
    e.preventDefault()
    void router.push(href)
  }
}
</script>

<template>
  <section
    class="rounded border border-(--ui-color-divider-less) p-4 space-y-3"
    data-testid="help-chat"
  >
    <div class="font-medium">
      Спросить ИИ по справке
    </div>
    <p class="text-sm opacity-70">
      BitrixGPT отвечает только по этой справке и даёт ссылки на разделы.
    </p>
    <div
      v-for="(t, i) in turns"
      :key="i"
      class="text-sm"
      @click="onClick"
    >
      <div
        v-if="t.role === 'user'"
        class="font-medium"
      >
        {{ t.content }}
      </div>
      <template v-else>
        <!-- eslint-disable vue/no-v-html -- ответ модели через markdown-it без сырого HTML -->
        <div
          class="help-answer"
          v-html="renderHelp(t.content)"
        />
        <!-- eslint-enable vue/no-v-html -->
        <div
          v-if="t.sources?.length"
          class="mt-1 text-xs opacity-70"
        >
          Источники:
          <NuxtLink
            v-for="s in t.sources"
            :key="s.url"
            :to="s.url"
            class="underline mr-2"
          >
            {{ s.title }}
          </NuxtLink>
        </div>
      </template>
    </div>
    <form
      class="flex gap-2"
      @submit.prevent="ask"
    >
      <B24Input
        v-model="question"
        class="flex-1"
        placeholder="Например: почему счёт не заполнился?"
        maxlength="2000"
        aria-label="Вопрос"
        data-testid="help-chat-question"
      />
      <B24Button
        type="submit"
        color="air-primary"
        label="Спросить"
        :loading="busy"
        :disabled="busy || !question.trim()"
        data-testid="help-chat-ask"
      />
    </form>
    <p
      v-if="error"
      class="text-sm text-(--ui-color-accent-main-alert)"
    >
      {{ error }}
    </p>
  </section>
</template>

<style scoped>
.help-answer :deep(a) { text-decoration: underline; }
.help-answer :deep(ul) { list-style: disc; padding-left: 1.25rem; }
.help-answer :deep(ol) { list-style: decimal; padding-left: 1.25rem; }
.help-answer :deep(p + p) { margin-top: 0.5rem; }
</style>
