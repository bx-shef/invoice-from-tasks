<script setup lang="ts">
// «Деньги рядом» (дизайн v2, слайдер счёта): полоски одной шкалы — по формуле (акцент) и выставлено
// (тёмная, итог жирным). Полоска «оценка ИИ» из макета — когда ИИ будет оценивать все задачи.
// Только рисует: суммы — из экономики.
import { formatMoney } from '~/utils/fillPreview'

const props = defineProps<{
  formula: number
  billed: number
}>()

const bars = computed(() => {
  const max = Math.max(props.formula, props.billed, 0.01)
  return [
    { key: 'formula', label: 'по формуле', value: props.formula, color: 'bg-(--tai-accent)' },
    { key: 'billed', label: 'выставлено', value: props.billed, color: 'bg-(--tai-text)' }
  ].map(b => ({ ...b, width: Math.round(b.value / max * 100) }))
})
</script>

<template>
  <div
    class="space-y-1 min-w-40"
    data-testid="money-bars"
  >
    <div
      v-for="b in bars"
      :key="b.key"
      class="grid grid-cols-[1fr_auto] items-center gap-2 text-xs"
      :title="b.label"
    >
      <span class="h-1.5 rounded-full bg-(--ui-color-bg-content-tertiary) overflow-hidden">
        <span
          class="block h-full rounded-full"
          :class="b.color"
          :style="{ width: `${b.width}%` }"
        />
      </span>
      <span
        class="text-right tabular-nums"
        :class="b.key === 'billed' ? 'font-semibold' : 'opacity-75'"
      >{{ formatMoney(b.value) }}</span>
    </div>
  </div>
</template>
