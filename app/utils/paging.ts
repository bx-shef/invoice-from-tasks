// Сбор всех страниц списочных методов — чистые функции над «принеси страницу», чтобы границы
// (последняя страница, потолок, ровно потолок) проверялись тестом, а не только чтением кода
// (находка тестировщика панели: чтение страниц в useInvoiceFill.ts тестами не покрывалось).

/**
 * Страницы со смещением (`start` — crm.item.productrow.list и прочие новые методы). Конец —
 * страница короче `pageSize`. Прочитали `maxItems` полными страницами — запрашиваем ещё одну:
 * пустая — данных ровно `maxItems`, непустая — ошибка `overflowMessage`, а не тихо неполный
 * список (раньше ровно 10 000 позиций давали ложную ошибку — находка /code-review).
 */
export async function collectOffsetPages<T>(
  fetchPage: (offset: number) => Promise<T[]>,
  pageSize: number,
  maxItems: number,
  overflowMessage: string
): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset)
    if (offset >= maxItems) {
      if (page.length === 0) return out
      throw new Error(overflowMessage)
    }
    out.push(...page)
    if (page.length < pageSize) return out
  }
}

export interface NumberedPage<T> {
  rows: T[]
  /** Всего строк по ответу портала; нет или 0 — неизвестно. */
  total?: unknown
}

/**
 * Страницы по номеру (1, 2, …) — старые методы с `NAV_PARAMS` (task.elapseditem.getlist). Конец —
 * страница короче `pageSize` или набранный `total`. Считаются СЫРЫЕ строки, а не разобранные:
 * иначе при одной битой строке мы запросили бы страницу за концом, а старые методы Битрикс24 на
 * ней, по опыту, отдают последнюю страницу ещё раз. `total` без значения не считается нулём —
 * иначе остановились бы после первой страницы. Упёрлись в `maxPages`, а данные есть — ошибка.
 */
export async function collectNumberedPages<T>(
  fetchPage: (page: number) => Promise<NumberedPage<T>>,
  pageSize: number,
  maxPages: number,
  overflowMessage: string
): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; ; page++) {
    const { rows, total } = await fetchPage(page)
    out.push(...rows)
    const known = typeof total === 'number' && Number.isFinite(total) && total > 0
    if (rows.length < pageSize || (known && out.length >= (total as number))) return out
    if (page >= maxPages) throw new Error(overflowMessage)
  }
}
