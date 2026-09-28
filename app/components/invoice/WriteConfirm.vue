<script setup lang="ts">
// Вопрос перед записью в счёт — на месте кнопок записи, а не системным окном (почему —
// app/utils/writeConfirm.ts). «Добавить» задаёт два вопроса подряд, «Заменить» — один.
// Кнопка согласия после каждого вопроса неактивна CONFIRM_ARM_MS — так видно правило answerYes:
// двойной клик не ответит «да» на непрочитанный вопрос. Фокус — на блок вопроса (кнопка записи,
// где он был, исчезла); Esc — «Отмена».
import type { ComponentPublicInstance } from 'vue'
import { CONFIRM_ARM_MS, type ConfirmState } from '~/utils/writeConfirm'

const props = defineProps<{ state: ConfirmState }>()
defineEmits<{ confirm: [], cancel: [] }>()

const question = computed(() => props.state.questions[props.state.step]!)
const title = computed(() => props.state.questions.length > 1
  ? `Подтвердите запись — вопрос ${props.state.step + 1} из ${props.state.questions.length}`
  : 'Подтвердите запись')

const armed = ref(false)
const root = useTemplateRef<ComponentPublicInstance>('root')
const arm = useTimeoutFn(() => {
  armed.value = true
}, CONFIRM_ARM_MS, { immediate: false })

// Каждый вопрос — новый объект состояния (answerYes): следим за ним, а не за номером шага, —
// иначе новый набор вопросов с тем же шагом достался бы уже активной кнопке.
watch(() => props.state, () => {
  armed.value = false
  arm.stop()
  arm.start()
  void nextTick(() => (root.value?.$el as HTMLElement | undefined)?.focus())
}, { immediate: true })
</script>

<template>
  <B24Alert
    ref="root"
    color="air-primary-warning"
    :title="title"
    :description="question.text"
    role="alertdialog"
    :aria-label="`${title}. ${question.text}`"
    tabindex="-1"
    data-testid="fill-confirm"
    :data-step="state.step + 1"
    @keydown.esc="$emit('cancel')"
  >
    <template #actions>
      <B24Button
        :color="state.mode === 'replace' ? 'air-primary-success' : 'air-primary'"
        :label="question.confirm"
        :disabled="!armed"
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
