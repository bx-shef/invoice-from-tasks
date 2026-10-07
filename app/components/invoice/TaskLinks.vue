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
  <B24Alert
    color="air-primary-warning"
    :title="title"
  >
    <template #description>
      <span
        v-for="link in links"
        :key="link.taskId"
        class="mr-1"
      ><InvoiceTaskLink
        :origin="origin"
        :task-id="link.taskId"
      />{{ link.text }}</span>
    </template>
  </B24Alert>
</template>
