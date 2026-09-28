// Каталог: единицы измерения строк счёта (catalog.measure.list — настройки и предпросмотр счёта) и
// ставки НДС портала (catalog.vat.list). Товары и папки каталога приложение больше не использует — наценка идёт по
// тегам задач (#3). Формат ответа — docs/REST_METHODS.md, разбор — app/utils/measures.ts и
// shared/domain/vat.ts.

import { parseVatRates, type PortalVat } from '#shared/domain/vat'
import { MAX_MEASURES, MEASURES_PAGE, measureListCall, vatListCall } from '~/utils/invoiceRequests'
import { parseMeasures, type MeasureOption } from '~/utils/measures'
import { collectOffsetPages } from '~/utils/paging'

export function useCatalog() {
  const b24 = useB24()

  async function measures(): Promise<MeasureOption[]> {
    // Разбираем после сбора: страница с битой записью короче 50, и листание кончилось бы раньше.
    const raw = await collectOffsetPages(
      async (start) => {
        const { method, params } = measureListCall(start)
        const res = await b24.call<{ measures?: unknown[] }>(method, params)
        return Array.isArray(res?.measures) ? res.measures : []
      },
      MEASURES_PAGE,
      MAX_MEASURES,
      `Единиц измерения в портале больше ${MAX_MEASURES} — справочник не прочитан`
    )
    return parseMeasures(raw)
  }

  /** Ставки НДС портала — варианты на вкладке «НДС» (активные; «Без НДС» добавляет вкладка). */
  async function vatRates(): Promise<PortalVat[]> {
    const { method, params } = vatListCall()
    return parseVatRates(await b24.call<unknown>(method, params))
  }

  return { measures, vatRates }
}
