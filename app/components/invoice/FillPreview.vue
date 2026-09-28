<script setup lang="ts">
// Предпросмотр строк счёта и проблем. Ничего не пишет — только показывает, что будет записано.
// Столбцы — как в товарной части счёта портала, расчёт строки — подстрокой под названием
// (просьба владельца 2026-09-28). Что стоит в каждом столбце и все подписи — app/utils/fillPreview.ts
// (с тестами); здесь только разметка.
import type { DraftRow, FillIssue, OpenTask } from '#shared/domain/fill'
import type { PriceMode } from '#shared/domain/settings'
import type { VatRate, VatTotals } from '#shared/domain/vat'
import { driftNote, formatMoney, issueText, openTaskText, placementNote, previewLine, vatCaption } from '~/utils/fillPreview'

const props = defineProps<{
  rows: DraftRow[]
  errors: FillIssue[]
  warnings: FillIssue[]
  /** Незакрытые задачи — отдельным блоком: их бывает много. */
  openTasks: OpenTask[]
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
  /** Валюта ставок; отличается от валюты счёта — ставка в подстроке подписана ею и «по курсу». */
  rateCurrency: string
  /** Адрес портала для ссылок на задачи (`https://portal.bitrix24.ru`). */
  origin: string
  userLabel: (id: number) => string
}>()

const lines = computed(() => props.rows.map(row => previewLine(row, {
  currency: props.currency,
  rateCurrency: props.rateCurrency,
  userLabel: props.userLabel
})))
const note = computed(() => placementNote(props.priceMode, props.vat?.rate))
const drift = computed(() => driftNote(lines.value, props.totals))

function taskHref(taskId: number): string {
  return `${props.origin}/company/personal/user/0/tasks/task/view/${taskId}/`
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

    <B24Alert
      v-if="openTasks.length"
      color="air-primary-warning"
      title="Не все задачи закрыты — время в них ещё может добавиться; записать счёт можно"
      data-testid="fill-open-tasks"
    >
      <template #description>
        <span
          v-for="(task, i) in openTasks"
          :key="task.taskId"
          class="mr-1"
        ><a
          :href="taskHref(task.taskId)"
          target="_blank"
          rel="noopener"
          class="underline"
        >Задача #{{ task.taskId }}</a>{{ openTaskText(task, i === openTasks.length - 1) }}</span>
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
        {{ note }}
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
            v-for="line in lines"
            :key="line.row.key"
            class="align-top border-t border-(--ui-color-divider-less)"
          >
            <td class="py-2 pr-3">
              {{ line.row.name }}
              <span class="block text-xs opacity-60">{{ line.calc }}</span>
              <span class="block text-xs opacity-60">
                <span :title="line.rateTitle">{{ line.basis }}</span> ·
                <a
                  :href="taskHref(line.row.taskId)"
                  target="_blank"
                  rel="noopener"
                  class="underline"
                >задача #{{ line.row.taskId }}</a>
              </span>
            </td>
            <td class="py-2 pr-3 text-right whitespace-nowrap">
              {{ line.price }}
            </td>
            <td class="py-2 pr-3 text-right whitespace-nowrap">
              {{ line.quantity }}<span
                v-if="unit"
                class="opacity-60 ml-1"
              >{{ unit }}</span>
            </td>
            <td class="py-2 pr-3 text-right whitespace-nowrap">
              {{ line.tax }}
            </td>
            <td class="py-2 pr-3 text-center">
              {{ line.included }}
            </td>
            <td class="py-2 pr-3 text-right whitespace-nowrap">
              {{ line.vat }}
            </td>
            <td class="py-2 text-right whitespace-nowrap">
              {{ line.total }}
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
              {{ formatMoney(totals.net) }}
            </td>
          </tr>
          <tr>
            <td
              colspan="6"
              class="py-1 pr-3 text-right"
              data-testid="fill-vat-label"
            >
              {{ vatCaption(vat) }}
            </td>
            <td
              class="py-1 text-right whitespace-nowrap"
              data-testid="fill-vat"
            >
              {{ formatMoney(totals.vat) }}
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
              {{ formatMoney(totals.total) }} {{ currency }}
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
