<script setup lang="ts">
// Экономика задач в окне счёта (economics.ts): сводка — выставлено, по формуле, дельта; ниже —
// задачи: часы (с пометкой «оценка ИИ»), формула, выставлено («Стоимость работ» — с пометкой),
// дельта и разница. Суммы — с НДС, как платит клиент. Пометки — цветной полосой слева и бейджем.
import type { TaskEconomy } from '#shared/domain/economics'
import { formatMoney } from '~/utils/fillPreview'

const props = defineProps<{ items: TaskEconomy[], threshold: number, origin: string, titles: Record<number, string>, currency: string }>()

const FLAG = {
  loss: { label: 'убыток', color: 'air-primary-alert', bar: 'border-l-(--ui-color-accent-main-alert)' },
  over: { label: 'завышение', color: 'air-primary-warning', bar: 'border-l-(--ui-color-accent-main-warning)' },
  missing: { label: 'нет данных', color: 'air-secondary', bar: 'border-l-(--ui-color-divider-default)' }
} as const

const totals = computed(() => {
  const formula = props.items.reduce((n, e) => n + e.formula, 0)
  const billed = props.items.reduce((n, e) => n + e.billed, 0)
  const delta = billed - formula
  return { formula, billed, delta, percent: formula > 0 ? Math.round(delta / formula * 1000) / 10 : null }
})
const flaggedCount = computed(() => props.items.filter(e => e.flag === 'loss' || e.flag === 'over').length)

function pct(v: number | null): string {
  return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('ru-RU')}%`
}
function signed(v: number): string {
  return `${v > 0 ? '+' : ''}${formatMoney(v)}`
}
function tone(v: number): string {
  return v < -0.004 ? 'text-(--ui-color-accent-main-alert)' : v > 0.004 ? 'text-(--ui-color-accent-main-success)' : 'opacity-60'
}
function hoursText(h: number): string {
  return `${h.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ч`
}
</script>

<template>
  <section
    v-if="items.length"
    class="space-y-3"
    data-testid="economics"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold">
        Экономика задач
        <HelpLink anchor="economics" />
      </h2>
      <span class="text-xs opacity-60">суммы с НДС · пометка — отклонение больше {{ threshold }}%</span>
    </div>

    <div class="grid gap-2 sm:grid-cols-3">
      <div class="rounded-lg border border-(--ui-color-divider-less) p-3">
        <div class="text-xs opacity-60">
          Выставлено клиенту
        </div>
        <div class="text-lg font-semibold tabular-nums">
          {{ formatMoney(totals.billed) }} <span class="text-xs font-normal opacity-60">{{ currency }}</span>
        </div>
      </div>
      <div class="rounded-lg border border-(--ui-color-divider-less) p-3">
        <div class="text-xs opacity-60">
          По формуле (часы × цена часа)
        </div>
        <div class="text-lg font-semibold tabular-nums">
          {{ formatMoney(totals.formula) }} <span class="text-xs font-normal opacity-60">{{ currency }}</span>
        </div>
      </div>
      <div
        class="rounded-lg border p-3"
        :class="totals.delta < -0.004 ? 'border-(--ui-color-accent-main-alert)' : totals.delta > 0.004 ? 'border-(--ui-color-accent-main-success)' : 'border-(--ui-color-divider-less)'"
        data-testid="economics-total-delta"
      >
        <div class="text-xs opacity-60">
          {{ totals.delta < -0.004 ? 'Мы в минусе' : totals.delta > 0.004 ? 'Мы в плюсе' : 'В ноль' }}
          <span v-if="flaggedCount"> · помечено задач: {{ flaggedCount }}</span>
        </div>
        <div
          class="text-lg font-semibold tabular-nums"
          :class="tone(totals.delta)"
        >
          {{ signed(totals.delta) }} <span class="text-xs font-normal">{{ pct(totals.percent) }}</span>
        </div>
      </div>
    </div>

    <div class="overflow-x-auto rounded-lg border border-(--ui-color-divider-less)">
      <table class="w-full text-sm">
        <thead class="bg-(--ui-color-bg-content-secondary)">
          <tr class="text-left text-xs opacity-70">
            <th class="py-2 pl-3 pr-2 text-right font-medium">
              №
            </th>
            <th class="py-2 pr-3 font-medium">
              Задача
            </th>
            <th class="py-2 pr-3 text-right font-medium">
              Часы
            </th>
            <th class="py-2 pr-3 text-right font-medium">
              По формуле
            </th>
            <th class="py-2 pr-3 text-right font-medium">
              Выставлено
            </th>
            <th class="py-2 pr-3 text-right font-medium">
              Дельта
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(e, n) in items"
            :key="e.taskId"
            class="border-t border-(--ui-color-divider-less) border-l-4"
            :class="e.flag ? FLAG[e.flag].bar : 'border-l-transparent'"
            :data-flag="e.flag ?? ''"
            data-testid="economics-row"
          >
            <td class="py-2 pl-3 pr-2 text-right align-top opacity-60 tabular-nums">
              {{ n + 1 }}
            </td>
            <td class="py-2 pr-3 align-top">
              <InvoiceTaskLink
                :origin="origin"
                :task-id="e.taskId"
              >
                {{ titles[e.taskId] || `Задача #${e.taskId}` }}
              </InvoiceTaskLink>
              <div class="mt-0.5 flex flex-wrap items-center gap-1 text-xs opacity-70">
                <span>#{{ e.taskId }}</span>
                <B24Badge
                  v-if="e.flag && e.flag !== 'missing'"
                  size="xs"
                  :color="FLAG[e.flag].color"
                  :label="FLAG[e.flag].label"
                />
                <B24Badge
                  v-if="e.estimated"
                  size="xs"
                  color="air-secondary-accent"
                  label="часы — оценка ИИ"
                />
                <B24Badge
                  v-if="e.fixed"
                  size="xs"
                  color="air-secondary"
                  label="стоимость работ"
                />
                <B24Badge
                  v-if="e.flag === 'missing' && !e.estimated"
                  size="xs"
                  color="air-secondary"
                  label="нет данных"
                />
              </div>
            </td>
            <td class="py-2 pr-3 text-right align-top whitespace-nowrap tabular-nums">
              {{ hoursText(e.hours) }}
            </td>
            <td class="py-2 pr-3 text-right align-top whitespace-nowrap tabular-nums">
              {{ formatMoney(e.formula) }}
            </td>
            <td class="py-2 pr-3 text-right align-top whitespace-nowrap tabular-nums">
              {{ formatMoney(e.billed) }}
            </td>
            <td class="py-2 pr-3 text-right align-top whitespace-nowrap tabular-nums">
              <div
                class="font-medium"
                :class="tone(e.delta)"
              >
                {{ signed(e.delta) }}
              </div>
              <div class="text-xs opacity-60">
                {{ pct(e.diffPercent) }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="text-xs opacity-60">
      Дельта — выставлено минус посчитанное по формуле: «−» — мы в минусе, «+» — в плюсе. Задачи открываются в слайдере.
    </p>
  </section>
</template>
