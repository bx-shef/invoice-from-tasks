// Каталог: единицы измерения строк счёта (catalog.measure.list — настройки и предпросмотр счёта) и
// ставки НДС портала (catalog.vat.list). Товары и папки каталога приложение больше не использует — наценка идёт по
// тегам задач (#3). Формат ответа — docs/REST_METHODS.md, разбор — app/utils/measures.ts и
// shared/domain/vat.ts.

import { parseVatRates, type PortalVat } from '#shared/domain/vat'
import { measureListCall, vatListCall } from '~/utils/invoiceRequests'
import { parseMeasures, type MeasureOption } from '~/utils/measures'

export function useCatalog() {
  const b24 = useB24()

  async function measures(): Promise<MeasureOption[]> {
    const { method, params } = measureListCall()
    return parseMeasures((await b24.call<{ measures?: unknown[] }>(method, params))?.measures)
  }

  /** Ставки НДС портала — варианты на вкладке «НДС» (активные; «Без НДС» добавляет вкладка). */
  async function vatRates(): Promise<PortalVat[]> {
    const { method, params } = vatListCall()
    return parseVatRates(await b24.call<unknown>(method, params))
  }

  return { measures, vatRates }
}
