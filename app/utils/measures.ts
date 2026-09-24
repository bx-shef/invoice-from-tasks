// Единицы измерения строк счёта: разбор catalog.measure.list в пункты списка настроек.
// Чистая функция — проверяется тестом (tests/measures.test.ts).
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

export interface MeasureOption {
  code: number
  title: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Пункты списка единиц: код и понятное название. Название — своё у портала (`measureTitle`,
 * `symbol`), иначе из ОКЕИ по коду, иначе международное обозначение, иначе «код N».
 * Запись без положительного кода отбрасывается: её нельзя передать в `measureCode`.
 */
export function parseMeasures(raw: unknown): MeasureOption[] {
  if (!Array.isArray(raw)) return []
  const out: MeasureOption[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const code = Number(o.code)
    if (!Number.isInteger(code) || code <= 0) continue
    const title = text(o.measureTitle) || text(o.symbol) || OKEI_NAMES[code] || text(o.symbolIntl) || text(o.symbolLetterIntl) || `код ${code}`
    out.push({ code, title })
  }
  return out
}
