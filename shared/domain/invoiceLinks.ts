// Ссылки счёта для печатных форм: адрес публичной страницы и адрес картинки с её QR-кодом.
// Приложение пишет их в поля счёта, выбранные в настройках; владелец ставит поля в шаблон документа
// (картинку — как картинку товара). Документы приложение само не создаёт.

import { camelFieldKey, normalizeFieldName } from './userFields'

/** Адрес публичной страницы счёта: `/p-<домен портала>/i-<ID счёта>`. */
export function publicInvoiceUrl(siteUrl: string, portalDomain: string, invoiceId: number | string): string {
  return `${siteUrl.replace(/\/$/, '')}/p-${portalDomain}/i-${invoiceId}`
}

/** Адрес PNG с QR-кодом публичной страницы: `/qr/<домен портала>/<ID счёта>.png`. */
export function publicQrUrl(siteUrl: string, portalDomain: string, invoiceId: number | string): string {
  return `${siteUrl.replace(/\/$/, '')}/qr/${portalDomain}/${invoiceId}.png`
}

/** Разбор `<ID счёта>.png` из адреса картинки; не похоже — `null`. */
export function qrInvoiceId(file: unknown): number | null {
  const m = /^([1-9]\d{0,9})\.png$/.exec(String(file ?? ''))
  return m ? Number(m[1]) : null
}

/** Типы полей счёта для отметки согласования: галка и дата. */
export const APPROVED_FIELD_TYPES = ['boolean'] as const
export const APPROVED_AT_FIELD_TYPES = ['date', 'datetime'] as const

/** Типы полей счёта для ссылок: строка и ссылка. */
export const LINK_FIELD_TYPES = ['string', 'url'] as const

export interface InvoiceFieldOption {
  /** Код поля, `UF_CRM_…`. */
  name: string
  label: string
  type: string
}

/**
 * Поля счёта для выбора (ответ crm.item.fields: `{ fields: { ufCrm…: { type, title, upperName,
 * isMultiple, isReadOnly } } }`): только свои UF типа строка или ссылка, не множественные.
 */
export function parseInvoiceLinkFields(result: unknown, types: readonly string[] = LINK_FIELD_TYPES): InvoiceFieldOption[] {
  const fields = (result as { fields?: unknown } | null)?.fields
  if (!fields || typeof fields !== 'object') return []
  const out: InvoiceFieldOption[] = []
  for (const value of Object.values(fields as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const f = value as Record<string, unknown>
    const name = normalizeFieldName(f.upperName)
    const type = typeof f.type === 'string' ? f.type : ''
    if (!name.startsWith('UF_') || !types.includes(type)) continue
    if (f.isMultiple === true || f.isReadOnly === true) continue
    const title = typeof f.title === 'string' && f.title.trim() ? f.title.trim() : name
    out.push({ name, label: title, type })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'ru'))
}

/**
 * Что дописать в счёт: выбранное поле, чьё значение не совпадает с нужной ссылкой. Пусто — счёт
 * уже в порядке, писать нечего (повторное открытие встройки не трогает счёт).
 *
 * @param item ответ crm.item.get (`item`): UF — в camelCase
 */
export function invoiceLinkUpdates(
  item: Record<string, unknown>,
  fields: { linkField: string, qrField: string },
  urls: { page: string, qr: string }
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [field, url] of [[fields.linkField, urls.page], [fields.qrField, urls.qr]] as const) {
    if (!field) continue
    const key = camelFieldKey(field)
    if (String(item[key] ?? item[field] ?? '') !== url) out[key] = url
  }
  return out
}

/** Поля счёта своего типа «Экономика счёта» (`rest_<ID>_ift_economics` в crm.item.fields). */
export function parseEconomicsFields(result: unknown): InvoiceFieldOption[] {
  const fields = (result as { fields?: unknown } | null)?.fields
  if (!fields || typeof fields !== 'object') return []
  const out: InvoiceFieldOption[] = []
  for (const value of Object.values(fields as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const f = value as Record<string, unknown>
    const name = normalizeFieldName(f.upperName)
    const type = typeof f.type === 'string' ? f.type.toLowerCase() : ''
    if (!name.startsWith('UF_') || !type.endsWith('ift_economics') || f.isMultiple === true) continue
    out.push({ name, label: typeof f.title === 'string' && f.title.trim() ? f.title.trim() : name, type })
  }
  return out
}
