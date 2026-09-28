// Единицы измерения строк счёта: разбор catalog.measure.list в пункты списка настроек и какая
// единица окажется в строках счёта (для предпросмотра). Чистые функции — tests/measures.test.ts.
//
// ⚠ Замер на тестовом портале (2026-09-24): у системных единиц `measureTitle` и `symbol` приходят
// `null` — заполнены только `symbolIntl` («pc. 1») и `symbolLetterIntl` («PCE. NMB»). Без запаса
// список в настройках показывал бы пустые названия. Поэтому название — из справочника ОКЕИ по
// коду, а международные обозначения — последний запас.

/** Названия частых кодов ОКЕИ — для единиц, у которых портал не отдал своё название. */
export const OKEI_NAMES: Readonly<Record<number, string>> = {
  6: 'Метр',
  112: 'Литр',
  163: 'Грамм',
  166: 'Килограмм',
  355: 'Минута',
  356: 'Час',
  359: 'Сутки',
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
export function rowUnit(measures: readonly MeasureOption[] | null, code: number | null): RowUnit {
  if (!measures) return { symbol: measureSymbol(code), notice: null }
  const fallback = measures.find(m => m.isDefault)
  if (code === null) return { symbol: fallback?.symbol ?? '', notice: null }
  const found = measures.find(m => m.code === code)
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
  return !!measures && !!saved && !measures.some(m => m.code === saved)
}

/**
 * Пункты списка единиц в настройках. Сохранённый код, которого нет в справочнике, остаётся в
 * списке с короткой пометкой (пояснение — под полем, {@link measureMissing}): иначе выбор
 * выглядел бы пустым, а в счёт молча шла бы единица по умолчанию. Справочник не прочитан
 * (`null`) — только сохранённый код, без пометки: проверить нечем.
 */
export function measureItems(measures: readonly MeasureOption[] | null, saved: number | null): Array<{ label: string, value: number }> {
  const items = (measures ?? []).map(m => ({ label: m.label, value: m.code }))
  if (saved && !items.some(i => i.value === saved)) {
    items.push({ label: measureMissing(measures, saved) ? `код ${saved} — нет в справочнике` : `код ${saved}`, value: saved })
  }
  return items
}
