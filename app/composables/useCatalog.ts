// Каталог товаров для настроек: поиск товаров и папок (наценки, товар строк), единицы измерения.
// Методы catalog.* и формат ответов — docs/REST_METHODS.md.

export interface CatalogOption {
  id: number
  name: string
}

/** Сколько результатов поиска показываем — остальное уточняется запросом. */
const SEARCH_LIMIT = 20

export function useCatalog() {
  const b24 = useB24()
  const iblockIds = useState<number[] | null>('catalog-iblocks', () => null)

  /**
   * Инфоблоки товарных каталогов. Каталог торговых предложений (у него задан `productIblockId`)
   * пропускаем: у предложений нет своих папок, наценки по папкам к ним неприменимы.
   */
  async function catalogs(): Promise<number[]> {
    if (iblockIds.value) return iblockIds.value
    const res = await b24.call<{ catalogs?: Array<{ iblockId?: unknown, productIblockId?: unknown }> }>('catalog.catalog.list', {
      select: ['iblockId', 'productIblockId']
    })
    iblockIds.value = (res?.catalogs ?? []).filter(c => !Number(c.productIblockId)).map(c => Number(c.iblockId)).filter(id => id > 0)
    return iblockIds.value
  }

  function options(rows: unknown[] | undefined): CatalogOption[] {
    return (rows ?? []).map((r) => {
      const o = (r ?? {}) as Record<string, unknown>
      return { id: Number(o.id) || 0, name: typeof o.name === 'string' ? o.name : '' }
    }).filter(o => o.id > 0)
  }

  async function searchProducts(query: string): Promise<CatalogOption[]> {
    const out: CatalogOption[] = []
    for (const iblockId of await catalogs()) {
      const res = await b24.call<{ products?: unknown[] }>('catalog.product.list', {
        select: ['id', 'iblockId', 'name'],
        filter: { iblockId, '%name': query.trim() }
      })
      out.push(...options(res?.products))
    }
    return out.slice(0, SEARCH_LIMIT)
  }

  async function searchSections(query: string): Promise<CatalogOption[]> {
    const out: CatalogOption[] = []
    for (const iblockId of await catalogs()) {
      const res = await b24.call<{ sections?: unknown[] }>('catalog.section.list', {
        select: ['id', 'name'],
        filter: { iblockId, '%name': query.trim() }
      })
      out.push(...options(res?.sections))
    }
    return out.slice(0, SEARCH_LIMIT)
  }

  async function productName(id: number): Promise<string> {
    try {
      const res = await b24.call<{ product?: { name?: unknown } }>('catalog.product.get', { id })
      return typeof res?.product?.name === 'string' ? res.product.name : `#${id}`
    } catch {
      return `#${id} (не найден)`
    }
  }

  async function measures(): Promise<Array<{ code: number, title: string }>> {
    const res = await b24.call<{ measures?: Array<{ code?: unknown, measureTitle?: unknown, symbol?: unknown }> }>('catalog.measure.list', {
      select: ['code', 'measureTitle', 'symbol']
    })
    return (res?.measures ?? [])
      .map(m => ({ code: Number(m.code) || 0, title: String(m.measureTitle ?? m.symbol ?? '') }))
      .filter(m => m.code > 0)
  }

  return { searchProducts, searchSections, productName, measures }
}
