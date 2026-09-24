// Каталог для настроек: только единицы измерения строк счёта (catalog.measure.list). Товары и
// папки каталога приложение больше не использует — наценка идёт по тегам задач (#3).
// Формат ответа — docs/REST_METHODS.md, разбор — app/utils/measures.ts.

import { parseMeasures, type MeasureOption } from '~/utils/measures'

export function useCatalog() {
  const b24 = useB24()

  async function measures(): Promise<MeasureOption[]> {
    const res = await b24.call<{ measures?: unknown[] }>('catalog.measure.list', {
      select: ['code', 'measureTitle', 'symbol', 'symbolIntl', 'symbolLetterIntl']
    })
    return parseMeasures(res?.measures)
  }

  return { measures }
}
