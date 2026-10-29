<script setup lang="ts">
// «Деньги рядом» (дизайн v2, слайдер счёта): полоски одной шкалы — по формуле (акцент), оценка ИИ
// (бирюза, если есть) и выставлено (тёмная, итог жирным). Только рисует: суммы — из экономики.
import { formatMoney } from '~/utils/fillPreview'

const props = defineProps<{
  formula: number
  billed: number
  /** Сумма по оценке ИИ; нет — полоски нет. */
  ai?: number | null
}>()

const bars = computed(() => {
  const max = Math.max(props.formula, props.billed, props.ai ?? 0, 0.01)
  const out = [{ key: 'formula', label: 'по формуле', value: props.formula, color: 'bg-(--tai-accent)' }]
  if (props.ai !== null && props.ai !== undefined) out.push({ key: 'ai', label: 'оценка ИИ', value: props.ai, color: 'bg-[#0E7A74]' })
  out.push({ key: 'billed', label: 'выставлено', value: props.billed, color: 'bg-(--tai-text)' })
  return out.map(b => ({ ...b, width: Math.round(b.value / max * 100) }))
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
