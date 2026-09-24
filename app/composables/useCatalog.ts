// Каталог для настроек: только единицы измерения строк счёта (catalog.measure.list). Товары и
// папки каталога приложение больше не использует — наценка идёт по тегам задач (#3).
// Формат ответа — docs/REST_METHODS.md.

export function useCatalog() {
  const b24 = useB24()

  async function measures(): Promise<Array<{ code: number, title: string }>> {
    const res = await b24.call<{ measures?: Array<{ code?: unknown, measureTitle?: unknown, symbol?: unknown }> }>('catalog.measure.list', {
      select: ['code', 'measureTitle', 'symbol']
    })
    return (res?.measures ?? [])
      .map(m => ({ code: Number(m.code) || 0, title: String(m.measureTitle ?? m.symbol ?? '') }))
      .filter(m => m.code > 0)
  }

  return { measures }
}
