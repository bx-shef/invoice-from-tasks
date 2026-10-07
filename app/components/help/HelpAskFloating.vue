<script setup lang="ts">
// Плавающее поле «Задать вопрос…» внизу страницы (как HdAskFloating в toolsai): Ctrl+I — фокус,
// Enter — вопрос ИИ-помощнику (открывается панель чата). Пока открыт чат — скрыто.
const { open: chatOpen, openChat } = useHelpChat()
const q = ref('')
const root = ref<HTMLElement | null>(null)

function submit() {
  if (!q.value.trim()) return
  openChat(q.value)
  q.value = ''
}
function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
    e.preventDefault()
    root.value?.querySelector('input')?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <form
    v-show="!chatOpen"
    ref="root"
    class="hd-ask-float"
    data-testid="help-ask-floating"
    @submit.prevent="submit"
  >
    <B24Input
      v-model="q"
      class="hd-ask-float-input"
      no-border
      placeholder="Задать вопрос ИИ…"
      aria-label="Задать вопрос ИИ-помощнику"
    />
    <B24Button
      type="submit"
      color="air-primary"
      size="sm"
      label="Спросить"
      :disabled="!q.trim()"
    />
  </form>
</template>
