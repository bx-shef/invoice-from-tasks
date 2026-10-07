<script setup lang="ts">
// Ссылка на задачу: во фрейме — слайдером портала (`slider.openPath`, b24jssdk; путь задачи
// `/company/personal/user/0/tasks/task/view/<ID>/` портал открывает в слайдере), вне фрейма или при
// отказе — обычной ссылкой в новой вкладке.
import { taskHref } from '~/utils/fillPreview'

const props = defineProps<{ origin: string, taskId: number }>()
const b24 = useB24()
const href = computed(() => taskHref(props.origin, props.taskId))

async function open(e: MouseEvent) {
  const frame = b24.get()
  // Ctrl/Cmd/средняя кнопка — человек хочет вкладку: не мешаем.
  if (!frame || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  try {
    await frame.slider.openPath(new URL(href.value))
  } catch {
    window.open(href.value, '_blank', 'noopener')
  }
}
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener"
    class="underline"
    data-testid="task-link"
    @click="open"
  ><slot>Задача #{{ taskId }}</slot></a>
</template>
