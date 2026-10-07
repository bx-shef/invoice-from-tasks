<script setup lang="ts">
// Экономика задач в окне счёта (economics.ts): по формуле, выставлено, дельта и разница, с
// пометками — убыток и завышение больше порога, нет данных (часы — оценка ИИ, нет ставки).
import type { TaskEconomy } from '#shared/domain/economics'
import { formatMoney } from '~/utils/fillPreview'

const props = defineProps<{ items: TaskEconomy[], threshold: number, origin: string, titles: Record<number, string> }>()

const FLAG = {
  loss: { label: 'убыток', color: 'air-primary-alert', row: 'bg-(--ui-color-accent-soft-red-3)' },
  over: { label: 'завышение', color: 'air-primary-warning', row: 'bg-(--ui-color-accent-soft-orange-3)' },
  missing: { label: 'нет данных', color: 'air-secondary', row: 'bg-(--ui-color-bg-content-secondary)' }
} as const

const totals = computed(() => {
  const formula = props.items.reduce((n, e) => n + e.formula, 0)
  const billed = props.items.reduce((n, e) => n + e.billed, 0)
  return { formula, billed, delta: billed - formula }
})

function pct(v: number | null): string {
  return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('ru-RU')}%`
}
function signed(v: number): string {
  return `${v > 0 ? '+' : ''}${formatMoney(v)}`
}
</script>

<template>
  <section
    v-if="items.length"
    class="space-y-2"
    data-testid="economics"
  >
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="font-medium">
        Экономика задач
      </h2>
      <span class="text-sm opacity-70">помечаем отклонение больше {{ threshold }}%</span>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left opacity-70">
            <th class="py-1 pr-3">
              Задача
            </th>
            <th class="py-1 pr-3 text-right">
              По формуле
            </th>
            <th class="py-1 pr-3 text-right">
              Выставлено
            </th>
            <th class="py-1 pr-3 text-right">
              Дельта
            </th>
            <th class="py-1 text-right">
              Разница
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in items"
            :key="e.taskId"
            :class="e.flag ? FLAG[e.flag].row : ''"
            :data-flag="e.flag ?? ''"
            data-testid="economics-row"
          >
            <td class="py-1 pr-3">
              <InvoiceTaskLink
                :origin="origin"
                :task-id="e.taskId"
              />
              <span class="opacity-80"> {{ titles[e.taskId] ?? '' }}</span>
              <B24Badge
                v-if="e.flag"
                class="ml-1"
                size="xs"
                :color="FLAG[e.flag].color"
                :label="e.estimated ? 'оценка ИИ' : FLAG[e.flag].label"
              />
            </td>
            <td class="py-1 pr-3 text-right whitespace-nowrap">
              {{ formatMoney(e.formula) }}
            </td>
            <td class="py-1 pr-3 text-right whitespace-nowrap">
              {{ formatMoney(e.billed) }}
            </td>
            <td
              class="py-1 pr-3 text-right whitespace-nowrap font-medium"
              :class="e.delta < 0 ? 'text-(--ui-color-accent-main-alert)' : e.delta > 0 ? 'text-(--ui-color-accent-main-success)' : ''"
            >
              {{ signed(e.delta) }}
            </td>
            <td class="py-1 text-right whitespace-nowrap">
              {{ pct(e.diffPercent) }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t font-semibold">
            <td class="py-1 pr-3">
              Итого
            </td>
            <td class="py-1 pr-3 text-right whitespace-nowrap">
              {{ formatMoney(totals.formula) }}
            </td>
            <td class="py-1 pr-3 text-right whitespace-nowrap">
              {{ formatMoney(totals.billed) }}
            </td>
            <td
              class="py-1 pr-3 text-right whitespace-nowrap"
              :class="totals.delta < 0 ? 'text-(--ui-color-accent-main-alert)' : totals.delta > 0 ? 'text-(--ui-color-accent-main-success)' : ''"
            >
              {{ signed(totals.delta) }}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="text-xs opacity-70">
      Дельта — выставлено минус формула (часы × цена часа), без НДС: «−» — мы в минусе, «+» — в плюсе.
      <HelpLink anchor="economics" />
    </p>
  </section>
</template>
