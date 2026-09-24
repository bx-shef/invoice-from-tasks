// Наценка на строки счёта — по тегам задачи (решение владельца по #3: товары каталога убраны).
// Правила «тег → наценка» идут списком; срабатывает ПЕРВОЕ правило, чей тег есть у задачи.
// Не сработало ни одно — наценка «на всё». Правила — docs/PROCESSING.md, «Наценка».

/** Правило наценки: тег задачи и процент. Порядок правил в списке — их приоритет. */
export interface TagMarkupRule {
  /** Тег так, как его ввёл человек (для показа); сравнение — через {@link normalizeTag}. */
  tag: string
  /** Наценка в процентах; 0 — без наценки, 120 — цена ×2,2. */
  percent: number
}

export interface MarkupSettings {
  /** Наценка «на всё» — применяется, если у задачи нет ни одного тега из правил. */
  defaultPercent: number
  /** Правила по тегам — сверху вниз, первое совпадение. */
  tags: TagMarkupRule[]
}

/** Откуда взялась наценка — показываем в предпросмотре, чтобы результат можно было проверить. */
export type MarkupSource = 'tag' | 'default'

export interface ResolvedMarkup {
  percent: number
  source: MarkupSource
  /** Тег сработавшего правила (как в настройках); для `default` — нет. */
  tag?: string
}

/** Разумные рамки наценки: скидку наценкой не делаем, тысячи процентов — почти наверняка опечатка. */
export const MIN_MARKUP = 0
export const MAX_MARKUP = 10_000
/** Длина тега в правиле — с запасом к тегам портала. */
export const MAX_TAG_LENGTH = 100

/** Приводит процент к числу в рамках; мусор → `null`. */
export function normalizePercent(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value)
  if (!Number.isFinite(n) || n < MIN_MARKUP || n > MAX_MARKUP) return null
  return Math.round(n * 100) / 100
}

/**
 * Ключ сравнения тегов: без `#` в начале, без лишних пробелов, без учёта регистра.
 * «#Срочно», « срочно » и «СРОЧНО» — один тег: человек вводит правило руками, а тег в задаче
 * ставит другой человек, и расхождение в регистре не должно молча менять цену.
 */
export function normalizeTag(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/^\s*#+/, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru')
}

/**
 * Выбор наценки для задачи: первое правило, чей тег есть у задачи, иначе «на всё».
 *
 * @param taskTags теги задачи как пришли из портала
 */
export function resolveMarkup(settings: MarkupSettings, taskTags: readonly string[]): ResolvedMarkup {
  const have = new Set(taskTags.map(normalizeTag).filter(Boolean))
  if (have.size) {
    for (const rule of settings.tags) {
      if (have.has(normalizeTag(rule.tag))) return { percent: rule.percent, source: 'tag', tag: rule.tag }
    }
  }
  return { percent: settings.defaultPercent, source: 'default' }
}

/** Цена с наценкой, до копеек. */
export function applyMarkup(price: number, percent: number): number {
  return Math.round(price * (100 + percent)) / 100
}
