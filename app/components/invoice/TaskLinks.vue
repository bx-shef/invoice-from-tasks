<script setup lang="ts">
// Блок-предупреждение со ссылками на задачи: «Задача #102 — выполняется, Задача #104 — …».
// Один на «незакрытые задачи» и «проверьте время» (находка /code-review: были две копии разметки);
// тексты и запятые — taskLinks в app/utils/fillPreview.ts, с тестами.
import type { TaskLinkItem } from '~/utils/fillPreview'

defineProps<{
  title: string
  links: TaskLinkItem[]
  /** Адрес портала для ссылок на задачи (`https://portal.bitrix24.ru`). */
  origin: string
}>()
</script>

<template>
  <!-- Мягкая плашка вместо яркой: предупреждение, а не ошибка — не кричит над таблицей -->
  <div
    class="rounded-lg border-l-4 border-(--ui-color-accent-main-warning) bg-(--ui-color-bg-content-secondary) px-4 py-3 text-sm space-y-1"
    role="note"
  >
    <div class="font-semibold">
      {{ title }}
    </div>
    <div class="leading-relaxed">
      <span
        v-for="link in links"
        :key="link.taskId"
        class="mr-2 inline-block"
      ><InvoiceTaskLink
        :origin="origin"
        :task-id="link.taskId"
      />{{ link.text }}</span>
    </div>
  </div>
</template>
