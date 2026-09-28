// Предпросмотр строк счёта: что стоит в каждом столбце и все подписи — чистые функции, чтобы
// «не то число не в том столбце» ловил тест, а не глаз (находка тестировщика панели по PR #24:
// мутант «Сумма налога ← сумма без налога» в шаблоне выживал). Компонент
// components/invoice/FillPreview.vue только рисует. Столбцы — как в товарной части счёта портала
// (просьба владельца 2026-09-28), скидок приложение не ставит — их столбцов нет.

import type { DraftRow, FillIssue, OpenTask } from '#shared/domain/fill'
import type { PriceMode } from '#shared/domain/settings'
import { formatDuration, formatRuDate } from '#shared/domain/time'
import { columnDrift, lineAmounts, vatLabel, vatRateText, type VatRate, type VatTotals } from '#shared/domain/vat'

/** Деньги как в карточке счёта: «1 122,00». */
export const formatMoney = (value: number): string =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Количество и часы: «5,5», до четырёх знаков — как хранит портал. */
export const formatNumber = (value: number): string =>
  value.toLocaleString('ru-RU', { maximumFractionDigits: 4 })

/** Валюты предпросмотра и имена сотрудников. */
export interface PreviewContext {
  /** Валюта счёта — в ней цены и суммы. */
  currency: string
  /** Валюта ставок; другая — ставка в подстроке подписана ею и «по курсу». */
  rateCurrency: string
  userLabel: (id: number) => string
}

/** Строка предпросмотра: значения столбцов слева направо и подстроки расчёта. */
export interface PreviewLine {
  row: DraftRow
  price: string
  quantity: string
  /** «20%», «Без НДС». */
  tax: string
  /** Налог включён в цену: «нет» (налог сверху, решение владельца #4) или «—» без налога. */
  included: string
  /** «Сумма налога» строки. */
  vat: string
  /** «Сумма» строки — с налогом. */
  total: string
  /** «Сумма» строки числом — для сверки столбца с «Общей суммой». */
  totalValue: number
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
 * Откуда цена часа. Валюта ставок другая — «по курсу»: иначе «100,00 RUB + наценка 70%» рядом с
 * ценой часа 2,02 USD читалось бы как ошибка (находка /code-review).
 */
export function rateBasis(row: DraftRow, ctx: PreviewContext): string {
  const converted = ctx.rateCurrency && ctx.rateCurrency !== ctx.currency ? ` ${ctx.rateCurrency} по курсу` : ''
  return `ставка ${formatMoney(row.baseRate)}${converted} + наценка ${row.markupPercent}% (${markupLabel(row)})`
}

export function previewLine(row: DraftRow, ctx: PreviewContext): PreviewLine {
  const amounts = lineAmounts(row)
  return {
    row,
    price: formatMoney(row.price),
    quantity: formatNumber(row.quantity),
    tax: vatRateText(row.taxRate),
    included: row.taxRate === null ? '—' : 'нет',
    vat: formatMoney(amounts.vat),
    total: formatMoney(amounts.total),
    totalValue: amounts.total,
    calc: `${ctx.userLabel(row.userId)} · ${hoursText(row)} × ${formatMoney(row.hourPrice)} = ${formatMoney(row.sum)}`,
    basis: rateBasis(row, ctx),
    rateTitle: `Ставка на ${formatRuDate(row.rateDate)}`
  }
}

/** Подпись под таблицей: как цена и налог лягут в счёт. */
export function placementNote(priceMode: PriceMode, rate: VatRate | undefined): string {
  const placement = priceMode === 'sum'
    ? 'в счёт: цена — сумма строки, количество — 1'
    : 'в счёт: цена — цена часа, количество — часы'
  return rate === null
    ? `Без НДС — налога в строках нет; ${placement}`
    : `Цена — без НДС, налог сверху (в цену не включён); ${placement}`
}

/** Подпись итога налога: ставка и чьи это реквизиты. */
export function vatCaption(vat: { rate: VatRate, company: string } | null): string {
  return vat ? `Сумма налога (${vatLabel(vat.rate)} — реквизиты «${vat.company}»):` : 'Сумма налога:'
}

/**
 * Пояснение, если столбец «Сумма» расходится с «Общей суммой»: строки округлены каждая, итог —
 * один раз. `null` — сходится. «Сумма налога» сходится всегда (налог счёта — сумма налогов
 * строк), а сумм без налога в столбцах нет — о них и не говорим (находка /code-review: прежнее
 * пояснение про «без налога» появлялось почти на каждом втором счёте).
 */
export function driftNote(lines: readonly PreviewLine[], totals: VatTotals): string | null {
  const drift = columnDrift(lines.map(l => l.totalValue), totals.total)
  if (!drift) return null
  return 'Каждая строка округлена до копеек, а «Общую сумму» портал округляет один раз — поэтому '
    + `столбец «Сумма» расходится с ней на ${formatMoney(Math.abs(drift))}. В счёте будет «Общая сумма» как здесь.`
}

/** Текст проблемы после ссылки «Задача #N»: «: причина»; без задачи — только причина. */
export function issueText(issue: FillIssue): string {
  return issue.taskId ? `: ${issue.message}` : issue.message
}

/** Текст после ссылки на незакрытую задачу: « — выполняется,», у последней — без запятой. */
export function openTaskText(task: OpenTask, last: boolean): string {
  return ` — ${task.status}${last ? '' : ','}`
}
