// Предпросмотр строк счёта: столбцы, итоги и все подписи — чистые функции, чтобы «не то число
// не в том столбце» ловил тест, а не глаз (находки тестировщика панели по PR #24: мутант «Сумма
// налога ← сумма без налога» выживал сначала в шаблоне, потом — в перестановке ячеек). Шаблон
// components/invoice/FillPreview.vue только обходит массивы отсюда. Столбцы — как в товарной
// части счёта портала (просьба владельца 2026-09-28), скидок приложение не ставит — их столбцов нет.

import type { DraftRow, FillIssue, OpenTask } from '#shared/domain/fill'
import { roundMoney } from '#shared/domain/money'
import type { PriceMode } from '#shared/domain/settings'
import { taskPath } from '#shared/domain/tasks'
import { formatDuration, formatRuDate } from '#shared/domain/time'
import { columnDrift, lineAmounts, vatLabel, vatRateText, type VatRate, type VatTotals } from '#shared/domain/vat'

const NBSP = ' '

/** Целая часть с разрядами через неразрывный пробел, как в карточке счёта: «1 122». */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/**
 * Деньги как в карточке счёта: «1 122,00». Без `toLocaleString`: его вывод зависит от ICU среды
 * (в урезанной сборке Node — «1122.00»), так же сделаны formatUsage и formatRate. −0 — «0,00».
 */
export function formatMoney(value: number): string {
  const fixed = roundMoney(Math.abs(value)).toFixed(2)
  const [int, frac] = fixed.split('.') as [string, string]
  const sign = value < 0 && fixed !== '0.00' ? '-' : ''
  return `${sign}${groupThousands(int)},${frac}`
}

/** Количество, часы, проценты: до четырёх знаков, без хвостовых нулей — «5,5», «12,5». */
export function formatNumber(value: number): string {
  const rounded = Math.round(Math.abs(value) * 10_000) / 10_000
  const [int, frac] = String(rounded).split('.') as [string, string | undefined]
  const sign = value < 0 && rounded !== 0 ? '-' : ''
  return `${sign}${groupThousands(int)}${frac ? `,${frac}` : ''}`
}

/** Пересчёт валюты и имена сотрудников для подстрок. */
export interface PreviewContext {
  /**
   * Валюта ставок, если цены пересчитаны по курсу (fill.conversion), иначе `null`. Берётся из
   * самого пересчёта, а не из сравнения валют: у счёта без валюты пересчёта нет, и «по курсу»
   * было бы неправдой (находка /code-review).
   */
  convertedFrom: string | null
  userLabel: (id: number) => string
}

/** Столбцы с числами — справа от названия строки, в порядке товарной части счёта. */
export const PREVIEW_COLUMNS = [
  { title: 'Цена', align: 'right' },
  { title: 'Количество', align: 'right' },
  { title: 'Налог', align: 'right' },
  { title: 'Включён', align: 'center' },
  { title: 'Сумма налога', align: 'right' },
  { title: 'Сумма', align: 'right' }
] as const

/** Строка предпросмотра: ячейки в порядке {@link PREVIEW_COLUMNS} и подстроки расчёта. */
export interface PreviewLine {
  row: DraftRow
  /**
   * Цена; количество с единицей; налог («20%», «Без НДС»); включён ли налог в цену («нет» —
   * налог сверху, решение владельца #4; «—» без налога); сумма налога; сумма с налогом.
   */
  cells: string[]
  /** Подстрока: «сотрудник · часы × цена часа = сумма без налога». */
  calc: string
  /** Подстрока: откуда цена часа — ставка (и курс), наценка. */
  basis: string
  /** Подсказка к ставке: на какую дату она выбрана. */
  rateTitle: string
}

/** Часы строки: округлённые, а если округление их изменило — и сколько списано на самом деле. */
export function hoursText(row: DraftRow): string {
  const rounded = `${formatNumber(row.hours)} ч`
  return row.roundedSeconds !== row.seconds ? `${rounded} (списано ${formatDuration(row.seconds)})` : rounded
}

function markupLabel(row: DraftRow): string {
  return row.markupSource === 'tag' ? `#${row.markupTag ?? ''}` : 'на всё'
}

/**
 * Откуда цена часа. Цены пересчитаны — «100,00 RUB по курсу»: иначе «ставка 100 + наценка 70%»
 * рядом с ценой часа 2,02 USD читалось бы как ошибка (находка /code-review).
 */
export function rateBasis(row: DraftRow, ctx: PreviewContext): string {
  const converted = ctx.convertedFrom ? ` ${ctx.convertedFrom} по курсу` : ''
  return `ставка ${formatMoney(row.baseRate)}${converted} + наценка ${formatNumber(row.markupPercent)}% (${markupLabel(row)})`
}

/** Строка предпросмотра; `unit` — краткое обозначение единицы («ч»), пусто — без неё. */
export function previewLine(row: DraftRow, unit: string, ctx: PreviewContext): PreviewLine {
  const amounts = lineAmounts(row)
  return {
    row,
    cells: [
      formatMoney(row.price),
      unit ? `${formatNumber(row.quantity)}${NBSP}${unit}` : formatNumber(row.quantity),
      vatRateText(row.taxRate),
      row.taxRate === null ? '—' : 'нет',
      formatMoney(amounts.vat),
      formatMoney(amounts.total)
    ],
    calc: `${ctx.userLabel(row.userId)} · ${hoursText(row)} × ${formatMoney(row.hourPrice)} = ${formatMoney(row.sum)}`,
    basis: rateBasis(row, ctx),
    rateTitle: `Ставка на ${formatRuDate(row.rateDate)}`
  }
}

/** Подпись итога налога: ставка и чьи это реквизиты. */
export function vatCaption(vat: { rate: VatRate, company: string } | null): string {
  return vat ? `Сумма налога (${vatLabel(vat.rate)} — реквизиты «${vat.company}»):` : 'Сумма налога:'
}

/** Строка итогов под таблицей. */
export interface PreviewTotal {
  label: string
  value: string
  testId: string
  /** Итог счёта — крупнее и жирным. */
  strong: boolean
}

/** Итоги как их посчитает портал: без налога, налог, общая сумма (с валютой счёта). */
export function previewTotals(totals: VatTotals, vat: { rate: VatRate, company: string } | null, currency: string): PreviewTotal[] {
  return [
    { label: 'Сумма без налога:', value: formatMoney(totals.net), testId: 'fill-net', strong: false },
    { label: vatCaption(vat), value: formatMoney(totals.vat), testId: 'fill-vat', strong: false },
    { label: 'Общая сумма:', value: `${formatMoney(totals.total)} ${currency}`.trim(), testId: 'fill-total', strong: true }
  ]
}

/** Подпись над таблицей: как цена и налог лягут в счёт. */
export function placementNote(priceMode: PriceMode, rate: VatRate | undefined): string {
  const placement = priceMode === 'sum'
    ? 'в счёт: цена — сумма строки, количество — 1'
    : 'в счёт: цена — цена часа, количество — часы'
  return rate === null
    ? `Без НДС — налога в строках нет; ${placement}`
    : `Цена — без НДС, налог сверху (в цену не включён); ${placement}`
}

/**
 * Пояснение, если видимые числа строк не складываются в итоги: «Сумма» строк — с «Общей суммой»
 * (строки округлены каждая, итог — один раз); суммы без налога в подстроках — с «Суммой без
 * налога» (она — итог минус налог, а налог округлён по строкам: у строки 2,75 × 1,5 ч при 20%
 * подстрока «= 4,13», внизу 4,12). `null` — всё сходится. «Сумма налога» сходится всегда.
 */
export function driftNote(rows: readonly DraftRow[], totals: VatTotals): string | null {
  const total = columnDrift(rows.map(r => lineAmounts(r).total), totals.total)
  const net = columnDrift(rows.map(r => r.sum), totals.net)
  const parts: string[] = []
  if (total) {
    parts.push('Каждая строка округлена до копеек, а «Общую сумму» портал округляет один раз — поэтому '
      + `столбец «Сумма» расходится с ней на ${formatMoney(Math.abs(total))}.`)
  }
  if (net) {
    parts.push('«Сумма без налога» — это «Общая сумма» минус «Сумма налога», а налог округлён по строкам — '
      + `поэтому суммы в подстроках расчёта расходятся с ней на ${formatMoney(Math.abs(net))}.`)
  }
  return parts.length ? `${parts.join(' ')} В счёте будут итоги как здесь.` : null
}

/** Заголовок блока незакрытых задач: он виден и тогда, когда записать нельзя, — о записи ни слова. */
export const OPEN_TASKS_TITLE = 'Не все задачи закрыты — время в них ещё может добавиться'

/** Текст после ссылки на незакрытую задачу: « — выполняется,», у последней — без запятой. */
export function openTaskText(task: OpenTask, last: boolean): string {
  return ` — ${task.status}${last ? '' : ','}`
}

/** Текст проблемы после ссылки «Задача #N»: «: причина»; без задачи — только причина. */
export function issueText(issue: FillIssue): string {
  return issue.taskId ? `: ${issue.message}` : issue.message
}

/** Ссылка на задачу в портале (`origin` — `https://portal.bitrix24.ru`). */
export function taskHref(origin: string, taskId: number): string {
  return `${origin}${taskPath(taskId)}`
}
