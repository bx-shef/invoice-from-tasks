// Ссылки счёта для печатных форм: поля счёта для выбора в настройках и запись адресов публичной
// страницы и картинки QR в выбранные поля — правами сотрудника из встройки счёта. Разбор —
// shared/domain/invoiceLinks.ts.

import { INVOICE_ENTITY_TYPE_ID } from '#shared/domain/tasks'
import { invoiceLinkUpdates, parseInvoiceLinkFields, publicInvoiceUrl, publicQrUrl, type InvoiceFieldOption } from '#shared/domain/invoiceLinks'

/** Поля счёта на время страницы: вкладки настроек читают их трижды — запрос один. */
let fieldsCache: Promise<unknown> | null = null

export function useInvoiceLinks() {
  const b24 = useB24()

  /**
   * Все поля счёта (crm.item.fields) — настройки разбирают их по типам (parseInvoiceLinkFields).
   * `fresh` — перечитать (после «Создать поля»); сбой из кеша не держим.
   */
  async function rawFields(fresh = false): Promise<unknown> {
    if (fresh || !fieldsCache) {
      fieldsCache = b24.call<unknown>('crm.item.fields', { entityTypeId: INVOICE_ENTITY_TYPE_ID })
      fieldsCache.catch(() => {
        fieldsCache = null
      })
    }
    return fieldsCache
  }

  /** Поля счёта типа строка или ссылка — для выбора в настройках. */
  async function fields(): Promise<InvoiceFieldOption[]> {
    return parseInvoiceLinkFields(await rawFields())
  }

  /**
   * Дописать ссылки в счёт, если выбранные поля пусты или устарели. Ничего не выбрано или всё
   * совпадает — ни одного запроса записи. Возвращает, сколько полей записано.
   */
  async function sync(invoiceId: number, portalDomain: string, siteUrl: string, chosen: { linkField: string, qrField: string }): Promise<number> {
    if (!chosen.linkField && !chosen.qrField) return 0
    const res = await b24.call<{ item?: Record<string, unknown> }>('crm.item.get', { entityTypeId: INVOICE_ENTITY_TYPE_ID, id: invoiceId })
    const updates = invoiceLinkUpdates(res?.item ?? {}, chosen, {
      page: publicInvoiceUrl(siteUrl, portalDomain, invoiceId),
      qr: publicQrUrl(siteUrl, portalDomain, invoiceId)
    })
    const count = Object.keys(updates).length
    if (count) await b24.call('crm.item.update', { entityTypeId: INVOICE_ENTITY_TYPE_ID, id: invoiceId, fields: updates })
    return count
  }

  return { fields, rawFields, sync }
}
