// Стадии счёта для вкладки «Публичная страница» (#34). Разбор — app/utils/invoiceStages.ts.

import { collectOffsetPages } from '~/utils/paging'
import { invoiceStageEntities, stageOptions, templateOptions, type StageOption, type TemplateOption } from '~/utils/invoiceStages'

export function useInvoiceStages() {
  const b24 = useB24()

  async function list(): Promise<StageOption[]> {
    const entities = invoiceStageEntities(await b24.call<unknown>('crm.status.entity.types'))
    // Стадии всех воронок счёта — одним пакетом, а не запросом на воронку
    const raws = await b24.batch<unknown>(entities.map(e => ['crm.status.list', { filter: { ENTITY_ID: e.id }, order: { SORT: 'ASC' } }]))
    return entities.flatMap((e, i) => stageOptions(raws[i], e.category, entities.length > 1))
  }

  /** Шаблоны генератора документов — для выбора, какие PDF показывать клиенту (этап 5). */
  async function templates(): Promise<TemplateOption[]> {
    // Метод постраничный (`start`, по 50): шаблоны всех сущностей портала, их бывает много.
    const raw = await collectOffsetPages(
      async (start) => {
        const res = await b24.call<{ templates?: unknown }>('crm.documentgenerator.template.list', { select: ['id', 'name', 'active'], order: { id: 'asc' }, start })
        const list = res?.templates
        return Array.isArray(list) ? list : list && typeof list === 'object' ? Object.values(list) : []
      },
      50,
      500,
      'шаблонов документов больше 500 — список не показываем'
    )
    return templateOptions(raw)
  }

  return { list, templates }
}
