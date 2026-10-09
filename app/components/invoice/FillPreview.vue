<script setup lang="ts">
// Предпросмотр строк счёта и проблем. Ничего не пишет — только показывает, что будет записано.
// Столбцы — как в товарной части счёта портала, расчёт строки — подстрокой под названием
// (просьба владельца 2026-09-28). Столбцы, ячейки, итоги и подписи — app/utils/fillPreview.ts
// (с тестами); шаблон только обходит их массивы — переставить здесь столбец нечем.
import type { CurrencyConversion } from '#shared/domain/currency'
import type { DraftRow, FillIssue, OpenTask, TimeOutlier } from '#shared/domain/fill'
import type { PriceMode } from '#shared/domain/settings'
import type { VatRate, VatTotals } from '#shared/domain/vat'
import {
  alignClass,
  driftNote,
  issueText,
  OPEN_TASKS_TITLE,
  openTaskText,
  outlierTaskIds,
  outlierText,
  OUTLIERS_TITLE,
  placementNote,
  PREVIEW_COLUMNS,
  previewContext,
  previewLine,
  previewTotals,
  taskLinks,
  unitNoticeShown
} from '~/utils/fillPreview'

const props = defineProps<{
  rows: DraftRow[]
  errors: FillIssue[]
  warnings: FillIssue[]
  /** Незакрытые задачи — отдельным блоком: их бывает много. */
  openTasks: OpenTask[]
  /** Задачи со временем заметно больше обычного — блок и подсветка их строк. */
  outliers: TimeOutlier[]
  /** Итоги как их посчитает портал: без налога, налог, общая сумма (vatTotals). */
  totals: VatTotals
  /** НДС счёта и чьи это «Реквизиты вашей компании». */
  vat: { rate: VatRate, company: string } | null
  /** Как строки лягут в счёт: цена часа и часы или сумма и 1. */
  priceMode: PriceMode
  /** Обозначение единицы строк, как в счёте («ч», «шт», «чел.-ч»); пусто — неизвестно. */
  unit: string
  /** Единица из настроек не попадёт в счёт как есть (rowUnit) — первым пунктом предупреждений. */
  unitNotice: string | null
  /** Валюта счёта — в ней цены и суммы. */
  currency: string
  /** Пересчёт цен в валюту счёта; есть — ставка в подстроке подписана «по курсу». */
  conversion: CurrencyConversion | null
  /** Адрес портала для ссылок на задачи (`https://portal.bitrix24.ru`). */
  origin: string
  userLabel: (id: number) => string
}>()

const lines = computed(() => {
  const ctx = previewContext(props.conversion, props.userLabel)
  return props.rows.map(row => previewLine(row, props.unit, ctx))
})
const footer = computed(() => previewTotals(props.totals, props.vat, props.currency))
const note = computed(() => placementNote(props.priceMode, props.vat?.rate))
const drift = computed(() => driftNote(props.rows, props.totals))
const outlierIds = computed(() => outlierTaskIds(props.outliers))
const openLinks = computed(() => taskLinks(props.openTasks, openTaskText))
const outlierLinks = computed(() => taskLinks(props.outliers, outlierText))
const unitWarning = computed(() => unitNoticeShown(props.unitNotice, props.rows.length))
/** Один класс отступа на состояние: первый итог — после разделителя, итог счёта — просторнее. */
const footerPadding = (strong: boolean, i: number) => strong ? 'py-2' : i === 0 ? 'pt-3 pb-1' : 'py-1'
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
            <InvoiceTaskLink
              v-if="issue.taskId"
              :origin="origin"
              :task-id="issue.taskId"
            />{{ issueText(issue) }}
          </li>
        </ul>
      </template>
    </B24Alert>

    <B24Alert
      v-if="warnings.length || unitWarning"
      color="air-primary-warning"
      title="Обратите внимание"
      data-testid="fill-warnings"
    >
      <template #description>
        <ul class="list-disc pl-5">
          <li
            v-if="unitWarning"
            data-testid="fill-unit-notice"
          >
            {{ unitWarning }}
          </li>
          <li
            v-for="(issue, i) in warnings"
            :key="i"
          >
            <InvoiceTaskLink
              v-if="issue.taskId"
              :origin="origin"
              :task-id="issue.taskId"
            />{{ issueText(issue) }}
          </li>
        </ul>
      </template>
    </B24Alert>

    <InvoiceTaskLinks
      v-if="openLinks.length"
      :title="OPEN_TASKS_TITLE"
      :links="openLinks"
      :origin="origin"
      data-testid="fill-open-tasks"
    />

    <InvoiceTaskLinks
      v-if="outlierLinks.length"
      :title="OUTLIERS_TITLE"
      :links="outlierLinks"
      :origin="origin"
      data-testid="fill-outliers"
    />

    <div
      v-if="rows.length"
      class="overflow-x-auto"
    >
      <p
        class="text-xs opacity-70 mb-2"
        data-testid="fill-placement"
      >
        {{ note }}
      </p>
      <table
        class="fill-table w-full text-sm"
        data-testid="fill-preview"
      >
        <thead>
          <tr class="text-left opacity-70">
            <th
              scope="col"
              class="py-2 pr-2 text-right font-medium"
            >
              №
            </th>
            <th
              scope="col"
              class="py-2 pr-3 font-medium"
            >
              Название строки
            </th>
            <th
              v-for="(column, c) in PREVIEW_COLUMNS"
              :key="column.title"
              scope="col"
              class="py-2 font-medium whitespace-nowrap"
              :class="[alignClass(column), c < PREVIEW_COLUMNS.length - 1 ? 'pr-3' : '']"
            >
              {{ column.title }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(line, n) in lines"
            :key="line.row.key"
            class="align-top border-t border-(--ui-color-divider-less)"
            :class="{ 'fill-outlier': outlierIds.has(line.row.taskId) }"
            :data-outlier="outlierIds.has(line.row.taskId) || undefined"
          >
            <td class="py-2 pr-2 text-right opacity-60 tabular-nums">
              {{ n + 1 }}
            </td>
            <td class="py-2 pr-3">
              <span class="font-medium">{{ line.row.name }}</span>
              <span class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                <B24Badge
                  :color="line.kind === 'fixed' ? 'air-primary-copilot' : 'air-secondary-accent'"
                  size="xs"
                  :label="line.kind === 'fixed' ? 'фикс' : 'расчёт'"
                  :title="line.kind === 'fixed' ? 'Сумма — «Стоимость работ» из задачи' : 'Сумма — часы × цена часа'"
                />
                <span class="opacity-75">{{ line.detail }}</span>
                <span
                  v-if="outlierIds.has(line.row.taskId)"
                  class="text-(--ui-color-accent-main-warning) font-medium"
                >· время больше обычного</span>
              </span>
              <span class="block text-xs opacity-60 mt-0.5">
                <span :title="line.rateTitle">{{ line.basis }}</span> ·
                <InvoiceTaskLink
                  :origin="origin"
                  :task-id="line.row.taskId"
                >задача #{{ line.row.taskId }}</InvoiceTaskLink>
              </span>
            </td>
            <td
              v-for="(cell, c) in line.cells"
              :key="c"
              class="py-2 whitespace-nowrap"
              :class="[alignClass(PREVIEW_COLUMNS[c]), c < line.cells.length - 1 ? 'pr-3' : '']"
            >
              {{ cell }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr
            v-for="(item, i) in footer"
            :key="item.testId"
            :class="[{ 'text-base font-semibold': item.strong }, { 'border-t border-(--ui-color-divider-less)': i === 0 }]"
          >
            <th
              scope="row"
              :colspan="PREVIEW_COLUMNS.length + 1"
              class="pr-3 text-right"
              :class="[footerPadding(item.strong, i), item.strong ? 'font-semibold' : 'font-normal']"
            >
              {{ item.label }}
            </th>
            <td
              class="text-right whitespace-nowrap"
              :class="footerPadding(item.strong, i)"
              :data-testid="item.testId"
            >
              {{ item.value }}
            </td>
          </tr>
        </tfoot>
      </table>
      <p
        v-if="drift"
        class="text-xs opacity-70 mt-1 text-right"
        data-testid="fill-drift"
      >
        {{ drift }}
      </p>
    </div>
  </div>
</template>

<style scoped>
/* Таблица — карточкой: шапка на мягком фоне, строки с воздухом */
.fill-table {
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--ui-color-design-plain-content-divider, rgb(0 0 0 / 0.08));
  border-radius: 12px;
  overflow: hidden;
  background: var(--ui-color-bg-content-primary, #fff);
}
.fill-table thead th {
  background: var(--ui-color-bg-content-secondary, #f5f7f8);
  padding-top: 10px;
  padding-bottom: 10px;
}
.fill-table th:first-child,
.fill-table td:first-child {
  padding-left: 12px;
}
.fill-table th:last-child,
.fill-table td:last-child {
  padding-right: 12px;
}
.fill-table tbody td {
  padding-top: 12px;
  padding-bottom: 12px;
}
/* Строка с подозрительным временем — полоса слева, а не заливка всей строки */
.fill-outlier td:first-child {
  box-shadow: inset 4px 0 0 var(--ui-color-accent-main-warning, #f7a700);
}
</style>
