<script setup lang="ts">
// Предпросмотр строк счёта и проблем. Ничего не пишет — только показывает, что будет записано.
import type { DraftRow, FillIssue } from '#shared/domain/fill'
import { formatDuration } from '#shared/domain/time'

const props = defineProps<{
  rows: DraftRow[]
  errors: FillIssue[]
  warnings: FillIssue[]
  total: number
  currency: string
  /** Адрес портала для ссылок на задачи (`https://portal.bitrix24.ru`). */
  origin: string
  userLabel: (id: number) => string
}>()

const money = (v: number) => v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hours = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 4 })
const markupLabel: Record<DraftRow['markupSource'], string> = { product: 'товар', section: 'папка', default: 'на всё' }

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
            >Задача #{{ issue.taskId }}</a><template v-if="issue.taskId">
              :
            </template>{{ issue.message }}
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
            Задача #{{ issue.taskId }}: {{ issue.message }}
          </li>
        </ul>
      </template>
    </B24Alert>

    <div
      v-if="rows.length"
      class="overflow-x-auto"
    >
      <table
        class="w-full text-sm"
        data-testid="fill-preview"
      >
        <thead>
          <tr class="text-left opacity-70">
            <th class="py-2 pr-3 font-medium">
              Название строки
            </th>
            <th class="py-2 pr-3 font-medium">
              Сотрудник
            </th>
            <th class="py-2 pr-3 font-medium text-right">
              Часы
            </th>
            <th class="py-2 pr-3 font-medium text-right">
              Ставка
            </th>
            <th class="py-2 pr-3 font-medium text-right">
              Наценка
            </th>
            <th class="py-2 pr-3 font-medium text-right">
              Цена
            </th>
            <th class="py-2 font-medium text-right">
              Сумма
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.key"
            class="align-top border-t border-(--ui-color-divider-less)"
          >
            <td class="py-2 pr-3">
              {{ row.name }}
              <a
                :href="taskHref(row.taskId)"
                target="_blank"
                rel="noopener"
                class="block text-xs opacity-60 underline"
              >задача #{{ row.taskId }}</a>
            </td>
            <td class="py-2 pr-3">
              {{ userLabel(row.userId) }}
            </td>
            <td
              class="py-2 pr-3 text-right whitespace-nowrap"
              :title="`Списано ${formatDuration(row.seconds)}, к оплате ${formatDuration(row.roundedSeconds)}`"
            >
              {{ hours(row.quantity) }}
            </td>
            <td
              class="py-2 pr-3 text-right whitespace-nowrap"
              :title="`Ставка с ${row.rateDate}`"
            >
              {{ money(row.baseRate) }}
            </td>
            <td class="py-2 pr-3 text-right whitespace-nowrap">
              {{ row.markupPercent }}% <span class="opacity-60">({{ markupLabel[row.markupSource] }})</span>
            </td>
            <td class="py-2 pr-3 text-right whitespace-nowrap">
              {{ money(row.price) }}
            </td>
            <td class="py-2 text-right whitespace-nowrap">
              {{ money(row.sum) }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t border-(--ui-color-divider-less) font-medium">
            <td
              colspan="6"
              class="py-2 pr-3 text-right"
            >
              Итого
            </td>
            <td
              class="py-2 text-right whitespace-nowrap"
              data-testid="fill-total"
            >
              {{ money(total) }} {{ currency }}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>
