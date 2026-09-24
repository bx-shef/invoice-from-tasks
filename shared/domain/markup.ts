// Наценка на строки счёта: на всё, на товары из папки каталога, на конкретный товар.
// Приоритет — от частного к общему: товар → ближайшая папка → «на всё» (docs/PROCESSING.md).

/** Правило наценки для папки или товара каталога. Имя хранится для показа в настройках. */
export interface MarkupRule {
  id: number
  name: string
  /** Наценка в процентах; 0 — без наценки, 120 — цена ×2,2. */
  percent: number
}

export interface MarkupSettings {
  /** Наценка «на всё» — применяется, если не сработало ни одно частное правило. */
  defaultPercent: number
  sections: MarkupRule[]
  products: MarkupRule[]
}

/** Откуда взялась наценка — показываем в предпросмотре, чтобы результат можно было проверить. */
export type MarkupSource = 'product' | 'section' | 'default'

export interface ResolvedMarkup {
  percent: number
  source: MarkupSource
  /** ID товара или папки, чьё правило сработало; для `default` — 0. */
  ruleId: number
}

/** Разумные рамки наценки: скидку наценкой не делаем, тысячи процентов — почти наверняка опечатка. */
export const MIN_MARKUP = 0
export const MAX_MARKUP = 10_000

/** Приводит процент к числу в рамках; мусор → `null`. */
export function normalizePercent(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value)
  if (!Number.isFinite(n) || n < MIN_MARKUP || n > MAX_MARKUP) return null
  return Math.round(n * 100) / 100
}

/**
 * Выбор наценки для строки.
 *
 * @param productId товар строки; `undefined` — строка без привязки к каталогу (сработает только «на всё»)
 * @param sectionChain папки товара от ближайшей к корню (ID); пусто — товар вне папок
 */
export function resolveMarkup(settings: MarkupSettings, productId: number | undefined, sectionChain: number[]): ResolvedMarkup {
  if (productId) {
    const byProduct = settings.products.find(r => r.id === productId)
    if (byProduct) return { percent: byProduct.percent, source: 'product', ruleId: byProduct.id }
    for (const sectionId of sectionChain) {
      const bySection = settings.sections.find(r => r.id === sectionId)
      if (bySection) return { percent: bySection.percent, source: 'section', ruleId: bySection.id }
    }
  }
  return { percent: settings.defaultPercent, source: 'default', ruleId: 0 }
}

/** Цена с наценкой, до копеек. */
export function applyMarkup(price: number, percent: number): number {
  return Math.round(price * (100 + percent)) / 100
}
