// Стадии счёта для вкладки «Публичная страница» (#34). Разбор — app/utils/invoiceStages.ts.

import { invoiceStageEntities, stageOptions, templateOptions, type StageOption, type TemplateOption } from '~/utils/invoiceStages'

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

  /** Шаблоны генератора документов — для выбора, какие PDF показывать клиенту (этап 5). */
  async function templates(): Promise<TemplateOption[]> {
    return templateOptions(await b24.call<unknown>('crm.documentgenerator.template.list', { select: ['id', 'name', 'active'], order: { name: 'asc' } }))
  }

  return { list, templates }
}
