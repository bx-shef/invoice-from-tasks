// Сборка строк товарной части счёта из задач. Чистая функция: на входе задачи, записи
// времени, ставки и настройки — на выходе строки и список проблем. Никаких REST-вызовов:
// их делает composable страницы (app/composables/useInvoiceFill.ts).
//
// Правила (ТЗ + решения, записанные в docs/PROCESSING.md):
// • тип 1 «задача» — одна строка на задачу; всё время задачи (всех участников) умножается на
//   ставку ОТВЕТСТВЕННОГО, действующую на дату последней записи времени;
// • тип 2 «время» — одна строка на запись времени; ставка того, кто списал время, на дату записи;
// • если чего-то не хватает — ошибка, и НИЧЕГО не пишется (ТЗ: «стоп работа и показ ошибки»).
//   Ошибки собираются все сразу, чтобы человек исправил задачи за один проход.

import { applyMarkup, resolveMarkup, type MarkupSource } from './markup'
import { findRate, type RateEntry } from './rates'
import type { AppSettings } from './settings'
import type { TaskInfo, TimeEntry } from './tasks'
import { formatDuration, roundSeconds, secondsToHours } from './time'

/** Тип заполнения: 1 — задача как учётная единица, 2 — записи затраченного времени. */
export type FillMode = 'task' | 'time'
/** Откуда брать задачи. Смешивать источники нельзя (ТЗ). */
export type TaskSource = 'deal' | 'invoice'

/** Длина названия товара в строке — у поля каталога предел 255 символов. */
export const MAX_ROW_NAME = 255

export interface ProductInfo {
  /** Папки товара от ближайшей к корню. */
  sectionChain: number[]
}

export interface FillInput {
  mode: FillMode
  tasks: TaskInfo[]
  entries: TimeEntry[]
  rates: RateEntry[]
  settings: AppSettings
  /** Сведения о товарах каталога, задействованных в строках (для наценок по папкам). */
  products: Map<number, ProductInfo>
  /** Имена сотрудников для понятных сообщений; нет имени — пишем `#ID`. */
  userNames?: Map<number, string>
}

export interface DraftRow {
  /** Ключ строки: `t<taskId>` (тип 1) или `e<entryId>` (тип 2). По нему приходят имена от BitrixGPT. */
  key: string
  taskId: number
  entryId?: number
  userId: number
  productId?: number
  name: string
  /** Исходная длительность и после округления, секунды. */
  seconds: number
  roundedSeconds: number
  /** Часы — идут в колонку «Количество». */
  quantity: number
  /** Ставка без наценки и дата, на которую она выбрана. */
  baseRate: number
  rateDate: string
  markupPercent: number
  markupSource: MarkupSource
  /** Цена часа с наценкой — идёт в колонку «Цена». */
  price: number
  /** Сумма строки для предпросмотра (портал считает её сам). */
  sum: number
}

export interface FillIssue {
  taskId: number
  entryId?: number
  message: string
}

export interface FillResult {
  rows: DraftRow[]
  errors: FillIssue[]
  /** Не мешают записи, но о них стоит знать (например, пропущенные нулевые записи). */
  warnings: FillIssue[]
}

function userLabel(input: FillInput, userId: number): string {
  return input.userNames?.get(userId) ?? `#${userId}`
}

/** Обрезка названия до предела поля с многоточием; пробелы по краям и переводы строк убираем. */
export function clampName(name: string): string {
  const flat = name.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_ROW_NAME ? `${flat.slice(0, MAX_ROW_NAME - 1)}…` : flat
}

function priceFor(input: FillInput, rate: RateEntry): Pick<DraftRow, 'productId' | 'markupPercent' | 'markupSource' | 'price'> {
  const productId = rate.productId ?? input.settings.defaultProductId ?? undefined
  const chain = productId ? input.products.get(productId)?.sectionChain ?? [] : []
  const markup = resolveMarkup(input.settings.markup, productId, chain)
  return {
    ...(productId ? { productId } : {}),
    markupPercent: markup.percent,
    markupSource: markup.source,
    price: applyMarkup(rate.rate, markup.percent)
  }
}

function money(value: number): number {
  return Math.round(value * 100) / 100
}

function buildTaskRows(input: FillInput, result: FillResult): void {
  const step = input.settings.rounding
  for (const task of input.tasks) {
    const entries = input.entries.filter(e => e.taskId === task.id)
    const total = entries.reduce((sum, e) => sum + e.seconds, 0)
    const problems: string[] = []
    if (!task.title) problems.push('у задачи нет названия')
    if (task.responsibleId === null) problems.push('у задачи нет ответственного')
    if (total === 0) {
      problems.push(task.timeSpentInLogs > 0
        ? 'журнал времени задачи не прочитан (нет доступа к записям времени?)'
        : 'в задаче нет затраченного времени')
    }
    const lastDate = entries.map(e => e.date).filter((d): d is string => !!d).sort().at(-1) ?? null
    if (total > 0 && !lastDate) problems.push('у записей времени нет даты — не на что выбрать ставку')
    let rate: RateEntry | null = null
    if (task.responsibleId !== null && lastDate) {
      rate = findRate(input.rates, task.responsibleId, lastDate)
      if (!rate) problems.push(`нет ставки для ${userLabel(input, task.responsibleId)} на ${lastDate}`)
    }
    if (problems.length || !rate || task.responsibleId === null || !lastDate) {
      for (const message of problems) result.errors.push({ taskId: task.id, message })
      continue
    }
    const rounded = roundSeconds(total, step)
    const quantity = secondsToHours(rounded)
    const priced = priceFor(input, rate)
    result.rows.push({
      key: `t${task.id}`,
      taskId: task.id,
      userId: task.responsibleId,
      name: clampName(task.title),
      seconds: total,
      roundedSeconds: rounded,
      quantity,
      baseRate: rate.rate,
      rateDate: lastDate,
      ...priced,
      sum: money(priced.price * quantity)
    })
  }
}

function buildTimeRows(input: FillInput, result: FillResult): void {
  const step = input.settings.rounding
  for (const task of input.tasks) {
    const entries = input.entries.filter(e => e.taskId === task.id)
    if (entries.length === 0) {
      result.errors.push({ taskId: task.id, message: task.timeSpentInLogs > 0
        ? 'журнал времени задачи не прочитан (нет доступа к записям времени?)'
        : 'в задаче нет записей затраченного времени' })
      continue
    }
    for (const entry of entries) {
      if (entry.seconds === 0) {
        result.warnings.push({ taskId: task.id, entryId: entry.id, message: 'запись времени нулевой длины пропущена' })
        continue
      }
      const problems: string[] = []
      if (!entry.comment) problems.push(`у записи времени ${formatDuration(entry.seconds)} нет описания — нечем назвать строку`)
      if (entry.userId === null) problems.push('у записи времени не указан сотрудник')
      if (!entry.date) problems.push('у записи времени нет даты')
      let rate: RateEntry | null = null
      if (entry.userId !== null && entry.date) {
        rate = findRate(input.rates, entry.userId, entry.date)
        if (!rate) problems.push(`нет ставки для ${userLabel(input, entry.userId)} на ${entry.date}`)
      }
      if (problems.length || !rate || entry.userId === null || !entry.date) {
        for (const message of problems) result.errors.push({ taskId: task.id, entryId: entry.id, message })
        continue
      }
      const rounded = roundSeconds(entry.seconds, step)
      const quantity = secondsToHours(rounded)
      const priced = priceFor(input, rate)
      result.rows.push({
        key: `e${entry.id}`,
        taskId: task.id,
        entryId: entry.id,
        userId: entry.userId,
        name: clampName(entry.comment),
        seconds: entry.seconds,
        roundedSeconds: rounded,
        quantity,
        baseRate: rate.rate,
        rateDate: entry.date,
        ...priced,
        sum: money(priced.price * quantity)
      })
    }
  }
}

/**
 * Собирает строки счёта. Если `errors` не пуст — писать в счёт нельзя, даже частично.
 */
export function buildRows(input: FillInput): FillResult {
  const result: FillResult = { rows: [], errors: [], warnings: [] }
  if (input.tasks.length === 0) {
    result.errors.push({ taskId: 0, message: 'не найдено ни одной задачи' })
    return result
  }
  if (input.mode === 'task') buildTaskRows(input, result)
  else buildTimeRows(input, result)
  return result
}

/**
 * Подставляет названия от BitrixGPT. Строка без названия — ошибка, а не тихий откат к
 * исходному тексту: человек выбрал режим ИИ и должен узнать, что он не сработал.
 */
export function applyNames(rows: DraftRow[], names: Record<string, string>): { rows: DraftRow[], errors: FillIssue[] } {
  const errors: FillIssue[] = []
  const out = rows.map((row) => {
    const name = clampName(typeof names[row.key] === 'string' ? names[row.key]! : '')
    if (!name) {
      errors.push({ taskId: row.taskId, ...(row.entryId ? { entryId: row.entryId } : {}), message: 'BitrixGPT не вернул название строки' })
      return row
    }
    return { ...row, name }
  })
  return { rows: out, errors }
}

/** Итог по строкам для предпросмотра. */
export function rowsTotal(rows: DraftRow[]): number {
  return money(rows.reduce((sum, r) => sum + r.sum, 0))
}

/** Строка в формате crm.item.productrow.set / .add (поля — по документации метода). */
export interface ProductRowPayload {
  productId?: number
  productName: string
  price: number
  quantity: number
  measureCode?: number
  sort: number
}

/** Перевод строк в поля товарных позиций. `sortStart` — чтобы в режиме «добавить» идти после существующих. */
export function toProductRows(rows: DraftRow[], settings: AppSettings, sortStart = 0): ProductRowPayload[] {
  return rows.map((row, i) => ({
    ...(row.productId ? { productId: row.productId } : {}),
    productName: row.name,
    price: row.price,
    quantity: row.quantity,
    ...(settings.measureCode ? { measureCode: settings.measureCode } : {}),
    sort: sortStart + (i + 1) * 10
  }))
}
