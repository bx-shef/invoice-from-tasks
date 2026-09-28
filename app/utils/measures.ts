// Единицы измерения строк счёта: разбор catalog.measure.list в пункты списка настроек и какая
// единица окажется в строках счёта (для предпросмотра). Чистые функции — tests/measures.test.ts.
//
// ⚠ Замер на тестовом портале (2026-09-24): у системных единиц `measureTitle` и `symbol` приходят
// `null` — заполнены только `symbolIntl` («pc. 1») и `symbolLetterIntl` («PCE. NMB»). Без запаса
// список в настройках показывал бы пустые названия. Поэтому название — из справочника ОКЕИ по
// коду, а международные обозначения — последний запас.

import type { PriceMode } from '#shared/domain/settings'
import { collectOffsetPages } from './paging'

/** Названия частых кодов ОКЕИ — для единиц, у которых портал не отдал своё название. */
export const OKEI_NAMES: Readonly<Record<number, string>> = {
  6: 'Метр',
  112: 'Литр',
  163: 'Грамм',
  166: 'Килограмм',
  355: 'Минута',
  356: 'Час',
  359: 'Сутки',
  539: 'Человеко-час',
  796: 'Штука'
}

/**
 * Краткие обозначения тех же кодов — как их пишет портал в строке счёта («шт» для 796, замер).
 * Запас для системных единиц: у них `symbol` в справочнике — `null` (замер 2026-09-24).
 */
export const OKEI_SYMBOLS: Readonly<Record<number, string>> = {
  6: 'м',
  112: 'л',
  163: 'г',
  166: 'кг',
  355: 'мин',
  356: 'ч',
  359: 'сут',
  539: 'чел.-ч',
  796: 'шт'
}

/** Обозначение единицы по одному коду, без справочника портала; незнакомый код — пусто. */
export function measureSymbol(code: number | null | undefined): string {
  return code ? OKEI_SYMBOLS[code] ?? '' : ''
}

/** Предел названия единицы: справочник ведёт администратор портала, длинная строка ломала бы список. */
export const MAX_MEASURE_TITLE = 100

export interface MeasureOption {
  code: number
  /** Название без кода; `''` — названия нет ни у портала, ни в ОКЕИ. */
  title: string
  /** Подпись пункта списка: «Штука (код 796)», без названия — «код 5002». */
  label: string
  /**
   * Обозначение, как его покажет строка счёта: своё у портала (`symbol` — у своих единиц он есть,
   * замер 2026-09-28: «чел.-ч» → в строке «чел.-ч»), иначе из ОКЕИ по коду; `''` — неизвестно.
   */
  symbol: string
  /** Единица по умолчанию: её портал ставит строке без `measureCode` (замер: «шт», 796). */
  isDefault: boolean
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_MEASURE_TITLE) : ''
}

/**
 * Пункты списка единиц. Название — своё у портала (`measureTitle`, `symbol`), иначе из ОКЕИ по
 * коду, иначе международное обозначение; подпись добавляет код, а без названия — только код
 * (не «код 5002 (код 5002)» — находка программиста панели). Запись без положительного целого
 * кода отбрасывается: её нельзя передать в `measureCode`.
 */
export function parseMeasures(raw: unknown): MeasureOption[] {
  if (!Array.isArray(raw)) return []
  const out: MeasureOption[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const code = Number(o.code)
    if (!Number.isInteger(code) || code <= 0) continue
    const title = text(o.measureTitle) || text(o.symbol) || OKEI_NAMES[code] || text(o.symbolIntl) || text(o.symbolLetterIntl)
    out.push({
      code,
      title,
      label: title ? `${title} (код ${code})` : `код ${code}`,
      symbol: text(o.symbol) || OKEI_SYMBOLS[code] || '',
      isDefault: o.isDefault === 'Y' || o.isDefault === true
    })
  }
  return out
}

/**
 * Справочник, которому можно верить: пустой ответ — «не прочитан», а не «единиц нет» (у портала
 * хотя бы единица по умолчанию есть всегда): иначе другая форма ответа дала бы ложное «нет в
 * справочнике» для существующей единицы (находка /code-review).
 */
function readList(measures: readonly MeasureOption[] | null): readonly MeasureOption[] | null {
  return measures?.length ? measures : null
}

/** Единица справочника по коду — одно правило для предпросмотра и настроек. */
function findMeasure(list: readonly MeasureOption[], code: number): MeasureOption | undefined {
  return list.find(m => m.code === code)
}

/** Почему справочник не прочитан: нет права или ошибка — молча; не ответил в срок — с пометкой. */
export type UnreadReason = 'failed' | 'timeout'

/** Какая единица окажется в строках счёта — для столбца «Количество» предпросмотра. */
export interface RowUnit {
  /** Обозначение («ч», «чел.-ч»); `''` — неизвестно, предпросмотр пишет число без единицы. */
  symbol: string
  /** Предупреждение: единица из настроек в счёт не попадёт, портал поставит свою. */
  notice: string | null
}

/**
 * Единица строк по справочнику портала и коду из настроек. Замер 2026-09-28 на тестовом портале:
 * строка без `measureCode` получает единицу по умолчанию («шт», 796); код, которого нет в
 * справочнике (356 «час» там не заведён), портал молча заменяет той же единицей по умолчанию —
 * предпросмотр показывает то, что будет в счёте, и предупреждает. Справочник не прочитан
 * (`null`: у сотрудника нет права чтения каталога) — обозначение из ОКЕИ по коду, без догадок.
 */
export function rowUnit(measures: readonly MeasureOption[] | null, code: number | null, unread: UnreadReason = 'failed'): RowUnit {
  const list = readList(measures)
  if (!list) {
    // Не ответил в срок (портал медленный, а не без прав) — о подмене единицы сказать нечем,
    // поэтому честно предупреждаем: единица показана по коду (находка /code-review).
    const notice = unread === 'timeout' && code !== null
      ? 'Справочник единиц портала не ответил вовремя — единица показана по коду; если её нет в '
      + 'справочнике, портал запишет единицу по умолчанию. Проверьте единицу в счёте после записи.'
      : null
    return { symbol: measureSymbol(code), notice }
  }
  const fallback = list.find(m => m.isDefault)
  if (code === null) return { symbol: fallback?.symbol ?? '', notice: null }
  const found = findMeasure(list, code)
  if (found) return { symbol: found.symbol, notice: null }
  const replacement = fallback ? `единицу по умолчанию «${fallback.title || fallback.symbol || `код ${fallback.code}`}»` : 'единицу по умолчанию'
  return {
    symbol: fallback?.symbol ?? '',
    notice: `Единицы с кодом ${code} из настроек нет в справочнике портала — портал запишет в строки ${replacement}. `
      + 'Администратор выбирает единицу в «Настройки → Общие».'
  }
}

/** Сохранённого кода нет в прочитанном справочнике — в счёт пойдёт единица по умолчанию. */
export function measureMissing(measures: readonly MeasureOption[] | null, saved: number | null): boolean {
  const list = readList(measures)
  return !!list && !!saved && !findMeasure(list, saved)
}

/**
 * Пункты списка единиц в настройках. Сохранённый код, которого нет в справочнике, остаётся в
 * списке с короткой пометкой (пояснение — под полем, {@link measureMissing}): иначе выбор
 * выглядел бы пустым, а в счёт молча шла бы единица по умолчанию. Справочник не прочитан
 * (`null`) — только сохранённый код, без пометки: проверить нечем.
 */
export function measureItems(measures: readonly MeasureOption[] | null, saved: number | null): Array<{ label: string, value: number }> {
  const list = readList(measures)
  const items = (list ?? []).map(m => ({ label: m.label, value: m.code }))
  if (saved && !(list && findMeasure(list, saved))) {
    items.push({ label: list ? `код ${saved} — нет в справочнике` : `код ${saved}`, value: saved })
  }
  return items
}

/** Код ОКЕИ «час». */
export const HOUR_MEASURE = 356

/** Слова, которые сами по себе — час: «час», «часа», «часов», «ч», у системных единиц — латиница. */
const HOUR_WORDS = new Set(['час', 'часа', 'часов', 'ч', 'h', 'hr', 'hrs', 'hour', 'hours'])
/**
 * Приставки составных единиц рабочего времени: «человеко-час», «нормо-час», «машино-час»,
 * «чел.-ч», «man-h». Прочие составные — не время: «киловатт-час», «ампер-час» (находка
 * программиста по PR #26).
 */
const HOUR_PREFIXES = new Set(['человеко', 'чел', 'нормо', 'машино', 'man'])

/**
 * Часовая ли единица по названию или обозначению: слово «час» или «ч» отдельно, не после «в»
 * («километр в час» — скорость), или составное с приставкой рабочего времени. Подстрока — не час:
 * «Часть», «Участок», «Часы», «км/ч». Разбор по словам, а не регуляркой: так правило читается.
 */
export function isHourName(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).map(w => w.replace(/[.,;:)]+$/, '')).filter(Boolean)
  return words.some((word, i) => {
    if (HOUR_WORDS.has(word)) return words[i - 1] !== 'в' && words[i - 1] !== 'per'
    const parts = word.split(/[-.]+/).filter(Boolean)
    // Одиночное слово уже разобрано выше: здесь — составные «человеко-час», «чел.-ч».
    return HOUR_WORDS.has(parts.at(-1) ?? '') && parts.slice(0, -1).every(p => HOUR_PREFIXES.has(p))
  })
}

/**
 * Единица «час» при «сумма × 1» читалась бы в счёте как «1 час» за всю работу — предупреждаем.
 * Не только код ОКЕИ 356: в справочнике портала «часа» может не быть, и администратор заводит
 * свою часовую единицу («чел.-ч») — её узнаём по обозначению и названию (находка /code-review).
 */
export function hourInSumMode(priceMode: PriceMode, measureCode: number | null, measures: readonly MeasureOption[] | null = null): boolean {
  if (priceMode !== 'sum' || measureCode === null) return false
  const list = readList(measures)
  // Справочник не прочитан — судим по коду ОКЕИ.
  if (!list) return measureCode === HOUR_MEASURE
  // Кода нет в справочнике — в счёт пойдёт единица по умолчанию, не час (об этом — measureMissing).
  const unit = findMeasure(list, measureCode)
  return !!unit && (unit.code === HOUR_MEASURE || isHourName(unit.symbol) || isHourName(unit.title))
}

/**
 * Весь справочник единиц постранично — одна реализация для страницы (useCatalog) и смока:
 * `fetchPage(start)` — ответ catalog.measure.list на смещение `start` (measureListCall). Разбираем
 * после сбора: страница с битой записью короче 50, и листание кончилось бы раньше. Ответ без
 * массива `measures` — ошибка: на второй странице он молча обрезал бы справочник, и своя единица
 * «пропала» бы (находка /code-review); вызывающий считает справочник не прочитанным. Больше
 * `max` — тоже ошибка.
 */
export async function readMeasures(
  fetchPage: (start: number) => Promise<unknown>,
  pageSize: number,
  max: number
): Promise<MeasureOption[]> {
  const raw = await collectOffsetPages(
    async (start) => {
      const res = await fetchPage(start)
      const page = res && typeof res === 'object' ? (res as { measures?: unknown }).measures : undefined
      if (!Array.isArray(page)) throw new Error(`catalog.measure.list: ответ без списка единиц (start ${start})`)
      return page
    },
    pageSize,
    max,
    `Единиц измерения в портале больше ${max} — справочник не прочитан`
  )
  return parseMeasures(raw)
}
