<script setup lang="ts">
// Предпросмотр строк счёта и проблем. Ничего не пишет — только показывает, что будет записано.
// Столбцы — как в товарной части счёта портала (цена, количество, налог, включён ли он в цену,
// сумма налога, сумма), расчёт строки — подстрокой под названием (просьба владельца 2026-09-28).
// Скидок приложение не ставит — их столбцов нет.
import type { DraftRow, FillIssue } from '#shared/domain/fill'
import type { PriceMode } from '#shared/domain/settings'
import { formatDuration, formatRuDate } from '#shared/domain/time'
import { columnDrift, lineAmounts, vatLabel, type VatRate, type VatTotals } from '#shared/domain/vat'

const props = defineProps<{
  rows: DraftRow[]
  errors: FillIssue[]
  warnings: FillIssue[]
  /** Итоги как их посчитает портал: без налога, налог, общая сумма (vatTotals). */
  totals: VatTotals
  /** НДС счёта и чьи это «Реквизиты вашей компании». */
  vat: { rate: VatRate, company: string } | null
  /** Как строки лягут в счёт: цена часа и часы или сумма и 1. */
  priceMode: PriceMode
  /** Краткое обозначение единицы строк («ч», «шт»); пусто — портал поставит свою. */
  unit: string
  /** Валюта счёта — в ней цены и суммы. */
  currency: string
  /** Валюта ставок; отличается от валюты счёта — ставка в подстроке подписана ею (цены пересчитаны). */
  rateCurrency: string
  /** Адрес портала для ссылок на задачи (`https://portal.bitrix24.ru`). */
  origin: string
  userLabel: (id: number) => string
}>()

const money = (v: number) => v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const number = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 4 })
const markupLabel = (row: DraftRow) => row.markupSource === 'tag' ? `#${row.markupTag ?? ''}` : 'на всё'
const placement = computed(() => props.priceMode === 'sum'
  ? 'в счёт: цена — сумма строки, количество — 1'
  : 'в счёт: цена — цена часа, количество — часы')
const placementNote = computed(() => props.vat?.rate === null
  ? `Без НДС — налога в строках нет; ${placement.value}`
  : `Цена — без НДС, налог сверху (в цену не включён); ${placement.value}`)
const lines = computed(() => props.rows.map(row => ({ row, amounts: lineAmounts(row) })))
const rateSuffix = computed(() => props.rateCurrency && props.rateCurrency !== props.currency ? ` ${props.rateCurrency}` : '')
/** Столбцы округлены построчно, итог портала — одной суммой: копейку разницы объясняем. */
const drift = computed(() => ({
  net: columnDrift(lines.value.map(l => l.amounts.net), props.totals.net),
  total: columnDrift(lines.value.map(l => l.amounts.total), props.totals.total)
}))
const vatCaption = computed(() => props.vat
  ? `Сумма налога (${vatLabel(props.vat.rate)} — реквизиты «${props.vat.company}»):`
  : 'Сумма налога:')
const driftText = computed(() => {
  const parts = [
    drift.value.net ? `без налога — на ${money(Math.abs(drift.value.net))}` : '',
    drift.value.total ? `общая сумма — на ${money(Math.abs(drift.value.total))}` : ''
  ].filter(Boolean)
  return 'Строки округлены до копеек по отдельности, а итог портал считает одной суммой, поэтому '
    + `столбцы расходятся с итогом на копейки (${parts.join('; ')}). В счёте будут цифры как здесь внизу.`
})

/** Текст проблемы после ссылки на задачу: «: причина»; без задачи — только причина. */
function issueText(issue: FillIssue): string {
  return issue.taskId ? `: ${issue.message}` : issue.message
}

function taskHref(taskId: number): string {
  return `${props.origin}/company/personal/user/0/tasks/task/view/${taskId}/`
}

/** Часы строки: округлённые, а если округление их изменило — и сколько списано на самом деле. */
function hoursText(row: DraftRow): string {
  const rounded = `${number(row.hours)} ч`
  return row.roundedSeconds !== row.seconds ? `${rounded} (списано ${formatDuration(row.seconds)})` : rounded
}
</script>

<template>
  <div class="space-y-4">
    <B24Alert
      v-if="errors.length"
      color="air-primary-alert"
      title="Заполнить счёт нельзя — в задачах не хватает данных"
      data-testid="fill-errors"
    >
      <template #description>
        <ul class="list-disc pl-5 space-y-1">
          <li
            v-for="(issue, i) in errors"
            :key="i"
          >
            <a
              v-if="issue.taskId"
              :href="taskHref(issue.taskId)"
              target="_blank"
              rel="noopener"
              class="underline"
            >Задача #{{ issue.taskId }}</a>{{ issueText(issue) }}
          </li>
        </ul>
      </template>
    </B24Alert>

    <B24Alert
      v-if="warnings.length"
      color="air-primary-warning"
      title="Обратите внимание"
    >
      <template #description>
        <ul class="list-disc pl-5">
          <li
            v-for="(issue, i) in warnings"
            :key="i"
          >
            <a
              v-if="issue.taskId"
              :href="taskHref(issue.taskId)"
              target="_blank"
              rel="noopener"
              class="underline"
            >Задача #{{ issue.taskId }}</a>{{ issueText(issue) }}
          </li>
        </ul>
      </template>
    </B24Alert>

    <div
      v-if="rows.length"
      class="overflow-x-auto"
    >
      <p
        class="text-xs opacity-70 mb-2"
        data-testid="fill-placement"
      >
        {{ placementNote }}
      </p>
      <table
        class="w-full text-sm"
        data-testid="fill-preview"
      >
        <thead>
          <tr class="text-left opacity-70">
            <th class="py-2 pr-3 font-medium">
              Название строки
            </th>
            <th class="py-2 pr-3 font-medium text-right">
              Цена
            </th>
            <th class="py-2 pr-3 font-medium text-right">
              Количество
            </th>
            <th class="py-2 pr-3 font-medium text-right">
              Налог
            </th>
            <th class="py-2 pr-3 font-medium text-center">
              Включён
            </th>
            <th class="py-2 pr-3 font-medium text-right">
              Сумма налога
            </th>
            <th class="py-2 font-medium text-right">
              Сумма
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="{ row, amounts } in lines"
            :key="row.key"
            class="align-top border-t border-(--ui-color-divider-less)"
          >
            <td class="py-2 pr-3">
              {{ row.name }}
              <span
                class="block text-xs opacity-60"
                data-testid="fill-row-calc"
              >
                {{ userLabel(row.userId) }} · {{ hoursText(row) }} × {{ money(row.hourPrice) }} = {{ money(row.sum) }}
              </span>
              <span class="block text-xs opacity-60">
                <span :title="`Ставка на ${formatRuDate(row.rateDate)}`">ставка {{ money(row.baseRate) }}{{ rateSuffix }}</span>
                + наценка {{ row.markupPercent }}% ({{ markupLabel(row) }}) ·
                <a
                  :href="taskHref(row.taskId)"
                  target="_blank"
                  rel="noopener"
                  class="underline"
                >задача #{{ row.taskId }}</a>
              </span>
            </td>
            <td class="py-2 pr-3 text-right whitespace-nowrap">
              {{ money(row.price) }}
            </td>
            <td class="py-2 pr-3 text-right whitespace-nowrap">
              {{ number(row.quantity) }}<span
                v-if="unit"
                class="opacity-60 ml-1"
              >{{ unit }}</span>
            </td>
            <td class="py-2 pr-3 text-right whitespace-nowrap">
              {{ row.taxRate === null ? 'Без НДС' : `${number(row.taxRate)} %` }}
            </td>
            <td class="py-2 pr-3 text-center">
              {{ row.taxRate === null ? '—' : 'нет' }}
            </td>
            <td class="py-2 pr-3 text-right whitespace-nowrap">
              {{ money(amounts.vat) }}
            </td>
            <td class="py-2 text-right whitespace-nowrap">
              {{ money(amounts.total) }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t border-(--ui-color-divider-less)">
            <td
              colspan="6"
              class="pt-3 pb-1 pr-3 text-right"
            >
              Сумма без налога:
            </td>
            <td
              class="pt-3 pb-1 text-right whitespace-nowrap"
              data-testid="fill-net"
            >
              {{ money(totals.net) }}
            </td>
          </tr>
          <tr>
            <td
              colspan="6"
              class="py-1 pr-3 text-right"
              data-testid="fill-vat-label"
            >
              {{ vatCaption }}
            </td>
            <td
              class="py-1 text-right whitespace-nowrap"
              data-testid="fill-vat"
            >
              {{ money(totals.vat) }}
            </td>
          </tr>
          <tr class="text-base font-semibold">
            <td
              colspan="6"
              class="py-2 pr-3 text-right"
            >
              Общая сумма:
            </td>
            <td
              class="py-2 text-right whitespace-nowrap"
              data-testid="fill-total"
            >
              {{ money(totals.total) }} {{ currency }}
            </td>
          </tr>
        </tfoot>
      </table>
      <p
        v-if="drift.net || drift.total"
        class="text-xs opacity-70 mt-1 text-right"
        data-testid="fill-drift"
      >
        {{ driftText }}
      </p>
    </div>
  </div>
</template>
