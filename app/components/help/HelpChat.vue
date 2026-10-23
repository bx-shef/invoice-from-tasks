<script setup lang="ts">
// ИИ-чат справки панелью справа (как HdChatOverlay в toolsai): приветствие с примерами, вопрос —
// серым пузырём справа, ответ — текстом со ссылками на разделы. Ответ печатается по мере генерации, как в skills-site:
// POST /api/kb/chat отдаёт поток NDJSON — сначала страницы-источники, затем куски текста BitrixGPT
// (shared/domain/kbStream.ts). История — в памяти страницы.
import { renderHelp } from '~/utils/help'
import { kbStreamParser, type KbStreamEvent } from '#shared/domain/kbStream'

const props = defineProps<{ page?: string }>()
const api = useApi()
const router = useRouter()
const { open, ask, topic, turns, closeChat } = useHelpChat()

const examples = ['Почему счёт не заполнился?', 'Как задать ставку сотрудника для клиента?']
const question = ref('')
const busy = ref(false)
const error = ref('')
const scroller = ref<HTMLElement | null>(null)
const lastQuestion = ref('')

async function send(text: string) {
  const q = text.trim()
  if (!q || busy.value) return
  turns.value.push({ role: 'user', content: q })
  question.value = ''
  lastQuestion.value = q
  busy.value = true
  error.value = ''
  const history = turns.value.map(t => ({ role: t.role, content: t.content }))
  // ответ — живой объект в списке: куски дописываются в него, Vue перерисовывает по мере прихода
  turns.value.push({ role: 'assistant', content: '' })
  const answer = turns.value[turns.value.length - 1]!
  const parser = kbStreamParser()
  let failed = ''
  const apply = (events: KbStreamEvent[]) => {
    for (const ev of events) {
      if (ev.type === 'sources') answer.sources = ev.sources
      else if (ev.type === 'text') answer.content += ev.text
      else failed = ev.message
    }
  }
  try {
    await api.postStream('/api/kb/chat', { messages: history, page: topic.value?.slug ?? props.page }, chunk => apply(parser.push(chunk)))
    apply(parser.flush())
    if (failed && !answer.content) throw new Error(failed)
    if (failed) answer.content += `\n\n_Ответ оборван: ${failed}_`
    else if (!answer.content) answer.content = 'Пустой ответ.'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    turns.value.splice(-2, 2)
    question.value = q
  } finally {
    busy.value = false
  }
}

function clear() {
  turns.value = []
  topic.value = null
  error.value = ''
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

// Вопрос из поиска, плавающего поля или «Обсудить с ИИ» пришёл вместе с открытием — отправляем сразу.
watch(() => [open.value, ask.value] as const, ([isOpen, q]) => {
  if (isOpen && q) {
    ask.value = ''
    void send(q)
  }
}, { immediate: true })

watch(() => [turns.value.length, turns.value[turns.value.length - 1]?.content.length, busy.value, error.value], () => {
  void nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  })
})
</script>

<template>
  <div
    class="hd-chat-overlay"
    :class="{ 'is-open': open }"
    role="complementary"
    aria-label="ИИ-помощник по справке"
    data-testid="help-chat"
  >
    <div class="hd-chat-bar">
      <span class="hd-chat-bar-title">ИИ-помощник</span>
      <B24Button
        v-if="turns.length"
        color="air-tertiary"
        size="sm"
        label="Очистить"
        @click="clear"
      />
      <B24Button
        color="air-tertiary"
        size="sm"
        label="✕"
        title="Свернуть"
        aria-label="Свернуть панель"
        @click="closeChat"
      />
    </div>
    <div class="hd-chat">
      <div
        ref="scroller"
        class="hd-chat-messages"
        @click="onClick"
      >
        <div class="hd-chat-welcome">
          <h2 class="hd-chat-welcome-title">
            ИИ-помощник по справке
          </h2>
          <p>ИИ отвечает только по этой справке и даёт ссылки на разделы. Например:</p>
          <ul>
            <li
              v-for="q in examples"
              :key="q"
            >
              <button
                type="button"
                class="hd-chat-example"
                :disabled="busy"
                @click="send(q)"
              >
                «{{ q }}»
              </button>
            </li>
          </ul>
        </div>

        <div
          v-for="(t, i) in turns"
          :key="i"
          :class="t.role === 'user' ? 'hd-chat-q' : 'hd-chat-a'"
        >
          <template v-if="t.role === 'user'">
            {{ t.content }}
          </template>
          <template v-else>
            <!-- eslint-disable vue/no-v-html -- ответ модели через markdown-it без сырого HTML -->
            <div
              class="hd-chat-md"
              v-html="renderHelp(t.content)"
            />
            <!-- eslint-enable vue/no-v-html -->
            <div
              v-if="t.sources?.length"
              class="hd-chat-sources"
            >
              <span>Источники:</span>
              <ul>
                <li
                  v-for="s in t.sources"
                  :key="s.url"
                >
                  <NuxtLink :to="s.url">
                    {{ s.title }}
                  </NuxtLink>
                </li>
              </ul>
            </div>
          </template>
        </div>

        <div
          v-if="busy && !turns[turns.length - 1]?.content"
          class="hd-chat-wait"
        >
          {{ turns[turns.length - 1]?.sources ? 'Нашёл страницы, пишу ответ…' : 'Ищу ответ в справке…' }}
        </div>
        <div
          v-if="error && !busy"
          class="hd-chat-error"
        >
          <p>Не удалось получить ответ: {{ error }}</p>
          <B24Button
            color="air-secondary-accent"
            size="sm"
            label="Повторить"
            @click="send(lastQuestion)"
          />
        </div>
      </div>

      <form
        class="hd-chat-form"
        @submit.prevent="send(question)"
      >
        <div
          v-if="topic"
          class="hd-chat-topic"
        >
          <span>Обсуждаем: <NuxtLink :to="{ path: '/help', query: { p: topic.slug } }">{{ topic.title }}</NuxtLink></span>
          <B24Button
            color="air-tertiary"
            size="xs"
            label="✕"
            title="Не обсуждать страницу"
            aria-label="Не обсуждать страницу"
            @click="topic = null"
          />
        </div>
        <div class="hd-chat-row">
          <B24Input
            v-model="question"
            class="hd-chat-input"
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
        </div>
        <p class="hd-chat-disclaimer">
          Ответы ИИ могут быть неточны, проверяйте важное по разделам справки.
        </p>
      </form>
    </div>
  </div>
</template>
