// Каталог: единицы измерения строк счёта (catalog.measure.list — настройки и предпросмотр счёта) и
// ставки НДС портала (catalog.vat.list). Товары и папки каталога приложение больше не использует — наценка идёт по
// тегам задач (#3). Формат ответа — docs/REST_METHODS.md, разбор — app/utils/measures.ts и
// shared/domain/vat.ts.

import { parseVatRates, type PortalVat } from '#shared/domain/vat'
import { MAX_MEASURES, MEASURES_PAGE, measureListCall, vatListCall } from '~/utils/invoiceRequests'
import { readMeasures, type MeasureOption } from '~/utils/measures'

export function useCatalog() {
  const b24 = useB24()

  /**
   * Весь справочник единиц — постранично по 50 (readMeasures). Бросает, если портал отказал
   * (например, нет права чтения каталога) или единиц больше MAX_MEASURES: вызывающий считает
   * справочник «не прочитанным» и берёт обозначения из ОКЕИ.
   */
  async function measures(): Promise<MeasureOption[]> {
    return readMeasures(
      async (start) => {
        const { method, params } = measureListCall(start)
        return b24.call<unknown>(method, params)
      },
      MEASURES_PAGE,
      MAX_MEASURES
    )
  }

  /** Ставки НДС портала — варианты на вкладке «НДС» (активные; «Без НДС» добавляет вкладка). */
  async function vatRates(): Promise<PortalVat[]> {
    const { method, params } = vatListCall()
    return parseVatRates(await b24.call<unknown>(method, params))
  }

  return { measures, vatRates }
}
