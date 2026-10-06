// Стадии счёта (#34, публичная страница): справочники с ENTITY_TYPE_ID = 31 из
// crm.status.entity.types (по воронке — свой справочник), стадии — crm.status.list по каждому.
// Чистые функции для useInvoiceStages.ts.

export interface StageOption {
  id: string
  /** «Воронка: Стадия» — если воронок несколько. */
  label: string
}

/** Справочники стадий счёта: `[{ ID, ENTITY_TYPE_ID: 31, CATEGORY_NAME? }]`. */
export function invoiceStageEntities(raw: unknown): Array<{ id: string, category: string }> {
  return (Array.isArray(raw) ? raw : [])
    .map(e => (e ?? {}) as Record<string, unknown>)
    .filter(e => Number(e.ENTITY_TYPE_ID) === 31 && typeof e.ID === 'string')
    .map(e => ({ id: String(e.ID), category: typeof e.CATEGORY_NAME === 'string' ? e.CATEGORY_NAME : '' }))
}

/** Стадии одного справочника (crm.status.list) в порядке SORT. */
export function stageOptions(raw: unknown, category: string, withCategory: boolean): StageOption[] {
  return (Array.isArray(raw) ? raw : [])
    .map(s => (s ?? {}) as Record<string, unknown>)
    .filter(s => typeof s.STATUS_ID === 'string' && s.STATUS_ID)
    .sort((a, b) => Number(a.SORT) - Number(b.SORT))
    .map((s) => {
      const name = typeof s.NAME === 'string' && s.NAME ? s.NAME : String(s.STATUS_ID)
      return { id: String(s.STATUS_ID), label: withCategory && category ? `${category}: ${name}` : name }
    })
}

/** Пункты выбора: стадии портала плюс сохранённые, которых в портале нет (с пометкой). */
export function stageItems(options: StageOption[] | null, saved: string[]): Array<{ label: string, value: string }> {
  const items = (options ?? []).map(o => ({ label: o.label, value: o.id }))
  for (const id of saved) {
    if (!items.some(i => i.value === id)) items.push({ label: options ? `${id} — нет в портале` : id, value: id })
  }
  return items
}

/** Адрес публичной страницы счёта — для подсказки в настройках и QR-кода. */
export function publicInvoiceUrl(siteUrl: string, portalDomain: string, invoiceId: number | string): string {
  return `${siteUrl.replace(/\/$/, '')}/p-${portalDomain}/i-${invoiceId}`
}
