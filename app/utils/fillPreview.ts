// Предпросмотр строк счёта: столбцы, итоги и все подписи — чистые функции, чтобы «не то число
// не в том столбце» ловил тест, а не глаз (находки тестировщика панели по PR #24: мутант «Сумма
// налога ← сумма без налога» выживал сначала в шаблоне, потом — в перестановке ячеек). Шаблон
// components/invoice/FillPreview.vue только обходит массивы отсюда. Столбцы — как в товарной
// части счёта портала (просьба владельца 2026-09-28), скидок приложение не ставит — их столбцов нет.

import type { CurrencyConversion } from '#shared/domain/currency'
import type { DraftRow, FillIssue, OpenTask } from '#shared/domain/fill'
import { roundMoney } from '#shared/domain/money'
import type { PriceMode } from '#shared/domain/settings'
import { taskPath } from '#shared/domain/tasks'
import { formatDuration, formatRuDate, HOURS_PRECISION } from '#shared/domain/time'
import { columnDrift, lineAmounts, vatLabel, vatRateText, type LineAmounts, type VatRate, type VatTotals } from '#shared/domain/vat'

const NBSP = '\u00A0'
/**
 * Больше — не сумма счёта, а сбой выше по цепочке: `toFixed` и `String` дали бы экспоненту
 * («1e+21»), а NaN — «NaN,undefined». Показываем прочерк, а не мусор.
 */
const MAX_SHOWN = 1e15
const NOT_A_NUMBER = '—'

/** Целая часть с разрядами через неразрывный пробел, как в карточке счёта: «1 122». */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/**
 * Деньги как в карточке счёта: «1 122,00». Без `toLocaleString`: его вывод зависит от ICU среды
 * (в урезанной сборке Node — «1122.00»), так же сделаны formatUsage и formatRate. −0 — «0,00».
 */
export function formatMoney(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= MAX_SHOWN) return NOT_A_NUMBER
  const fixed = roundMoney(Math.abs(value)).toFixed(2)
  const [int, frac] = fixed.split('.') as [string, string]
  const sign = value < 0 && fixed !== '0.00' ? '-' : ''
  return `${sign}${groupThousands(int)},${frac}`
}

/**
 * Количество, часы, проценты: до {@link HOURS_PRECISION} знаков, как хранятся часы строки, без
 * хвостовых нулей — «5,5», «12,5».
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= MAX_SHOWN) return NOT_A_NUMBER
  const factor = 10 ** HOURS_PRECISION
  const rounded = Math.round(Math.abs(value) * factor) / factor
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

/** Контекст из пересчёта валюты: подписывать ли ставку «по курсу» (и какой валютой). */
export function previewContext(conversion: CurrencyConversion | null, userLabel: (id: number) => string): PreviewContext {
  return { convertedFrom: conversion?.from ?? null, userLabel }
}

/** Что нужно ячейке: строка, её суммы и единица. */
interface CellInput {
  row: DraftRow
  amounts: LineAmounts
  unit: string
}

/** Столбец справа от названия строки: заголовок, выравнивание и что в ячейке. */
export interface PreviewColumn {
  title: string
  align: 'right' | 'center'
  cell: (input: CellInput) => string
}

/**
 * Столбцы в порядке товарной части счёта. Ячейка — из самого столбца: заголовок и значение не
 * разойдутся при перестановке (находка /code-review: раньше их связывала только позиция).
 */
export const PREVIEW_COLUMNS: readonly PreviewColumn[] = [
  { title: 'Цена', align: 'right', cell: ({ row }) => formatMoney(row.price) },
  {
    title: 'Количество',
    align: 'right',
    cell: ({ row, unit }) => unit ? `${formatNumber(row.quantity)}${NBSP}${unit}` : formatNumber(row.quantity)
  },
  { title: 'Налог', align: 'right', cell: ({ row }) => vatRateText(row.taxRate) },
  // Налог включён в цену: «нет» — налог сверху (решение владельца #4); «—» — налога нет.
  { title: 'Включён', align: 'center', cell: ({ row }) => row.taxRate === null ? '—' : 'нет' },
  { title: 'Сумма налога', align: 'right', cell: ({ amounts }) => formatMoney(amounts.vat) },
  { title: 'Сумма', align: 'right', cell: ({ amounts }) => formatMoney(amounts.total) }
]

/** Класс выравнивания столбца — один на заголовок и ячейки. */
export function alignClass(column: PreviewColumn | undefined): string {
  return column?.align === 'center' ? 'text-center' : 'text-right'
}

/** Строка предпросмотра: ячейки в порядке {@link PREVIEW_COLUMNS} и подстроки расчёта. */
export interface PreviewLine {
  row: DraftRow
  /** Значения ячеек — по одной на каждый из {@link PREVIEW_COLUMNS}, в том же порядке. */
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
  const input: CellInput = { row, amounts: lineAmounts(row), unit }
  return {
    row,
    cells: PREVIEW_COLUMNS.map(column => column.cell(input)),
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
 * подстрока «= 4,13», внизу 4,12). Налога нет — «без налога» и есть «Общая сумма», причина та же,
 * что у столбца «Сумма», и второе пояснение было бы неправдой (находка /code-review). `null` — всё
 * сходится. «Сумма налога» сходится всегда.
 */
export function driftNote(rows: readonly DraftRow[], totals: VatTotals): string | null {
  const total = columnDrift(rows.map(r => lineAmounts(r).total), totals.total)
  const net = columnDrift(rows.map(r => r.sum), totals.net)
  const parts: string[] = []
  if (total) {
    parts.push('Каждая строка округлена до копеек, а «Общую сумму» портал округляет один раз — поэтому '
      + `столбец «Сумма» расходится с ней на ${formatMoney(Math.abs(total))}.`)
  }
  if (net && totals.vat) {
    parts.push('«Сумма без налога» — это «Общая сумма» минус «Сумма налога», а налог округлён по строкам — '
      + `поэтому суммы в подстроках расчёта расходятся с ней на ${formatMoney(Math.abs(net))}.`)
  }
  return parts.length ? `${parts.join(' ')} В счёте будут итоги как здесь.` : null
}

/**
 * Предупреждение о единице — только когда есть строки: без строк писать нечего, и предупреждение
 * о подмене единицы было бы шумом (показ — FillPreview, «Обратите внимание» первым пунктом).
 */
export function unitNoticeShown(notice: string | null, rowCount: number): string | null {
  return notice && rowCount > 0 ? notice : null
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
