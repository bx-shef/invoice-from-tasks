// Стадии счёта для вкладки «Публичная страница» (#34). Разбор — app/utils/invoiceStages.ts.

import { invoiceStageEntities, stageOptions, type StageOption } from '~/utils/invoiceStages'

export function useInvoiceStages() {
  const b24 = useB24()

  async function list(): Promise<StageOption[]> {
    const entities = invoiceStageEntities(await b24.call<unknown>('crm.status.entity.types'))
    const out: StageOption[] = []
    for (const e of entities) {
      const raw = await b24.call<unknown>('crm.status.list', { filter: { ENTITY_ID: e.id }, order: { SORT: 'ASC' } })
      out.push(...stageOptions(raw, e.category, entities.length > 1))
    }
    return out
  }

  return { list }
}
