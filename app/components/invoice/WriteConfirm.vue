<script setup lang="ts">
// Вопрос перед записью в счёт — на месте кнопок записи, а не системным окном (почему —
// app/utils/writeConfirm.ts). «Добавить» задаёт два вопроса подряд, «Заменить» — один.
import type { ConfirmState } from '~/utils/writeConfirm'

const props = defineProps<{ state: ConfirmState }>()
defineEmits<{ confirm: [], cancel: [] }>()

const question = computed(() => props.state.questions[props.state.step]!)
const title = computed(() => props.state.questions.length > 1
  ? `Подтвердите запись — вопрос ${props.state.step + 1} из ${props.state.questions.length}`
  : 'Подтвердите запись')
</script>

<template>
  <B24Alert
    color="air-primary-warning"
    :title="title"
    :description="question.text"
    data-testid="fill-confirm"
    :data-step="state.step + 1"
  >
    <template #actions>
      <B24Button
        :color="state.mode === 'replace' ? 'air-primary-success' : 'air-primary'"
        :label="question.confirm"
        data-testid="fill-confirm-yes"
        @click="$emit('confirm')"
      />
      <B24Button
        color="air-tertiary"
        label="Отмена"
        data-testid="fill-confirm-no"
        @click="$emit('cancel')"
      />
    </template>
  </B24Alert>
</template>
