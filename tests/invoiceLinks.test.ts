import { describe, expect, it } from 'vitest'
import { invoiceLinkUpdates, parseInvoiceLinkFields, publicInvoiceUrl, publicQrUrl, qrInvoiceId } from '../shared/domain/invoiceLinks'
import { parseSettings } from '../shared/domain/settings'

const SITE = 'https://app.example.by/'

describe('адреса страницы и QR', () => {
  it('страница и картинка — по домену и ID, без двойного слэша', () => {
    expect(publicInvoiceUrl(SITE, 'bel.bitrix24.by', 145)).toBe('https://app.example.by/p-bel.bitrix24.by/i-145')
    expect(publicQrUrl(SITE, 'bel.bitrix24.by', 145)).toBe('https://app.example.by/qr/bel.bitrix24.by/145.png')
  })

  it('ID из имени картинки: только «<число>.png»', () => {
    expect(qrInvoiceId('145.png')).toBe(145)
    for (const bad of ['0.png', '145', '145.jpg', 'x.png', '-1.png', '12345678901.png', undefined]) expect(qrInvoiceId(bad)).toBeNull()
  })
})

describe('поля счёта для ссылок', () => {
  it('только свои UF строка/ссылка, не множественные и не только для чтения; по подписи', () => {
    const raw = {
      fields: {
        title: { type: 'string', title: 'Название', upperName: 'TITLE' },
        ufCrmSmartInvoiceQr: { type: 'url', title: 'QR', upperName: 'UF_CRM_SMART_INVOICE_QR', isMultiple: false },
        ufCrmSmartInvoiceLink: { type: 'string', title: 'Ссылка', upperName: 'UF_CRM_SMART_INVOICE_LINK' },
        ufCrmSmartInvoiceMany: { type: 'string', title: 'Много', upperName: 'UF_CRM_SMART_INVOICE_MANY', isMultiple: true },
        ufCrmSmartInvoiceRo: { type: 'url', title: 'Только чтение', upperName: 'UF_CRM_SMART_INVOICE_RO', isReadOnly: true },
        ufCrmSmartInvoiceNum: { type: 'double', title: 'Число', upperName: 'UF_CRM_SMART_INVOICE_NUM' }
      }
    }
    expect(parseInvoiceLinkFields(raw).map(f => f.name)).toEqual(['UF_CRM_SMART_INVOICE_LINK', 'UF_CRM_SMART_INVOICE_QR'])
    expect(parseInvoiceLinkFields(null)).toEqual([])
  })

  it('что дописать: только выбранные поля с другим значением, ключи — camelCase', () => {
    const urls = { page: 'https://a/p-x/i-1', qr: 'https://a/qr/x/1.png' }
    const chosen = { linkField: 'UF_CRM_SMART_INVOICE_LINK', qrField: 'UF_CRM_SMART_INVOICE_QR' }
    expect(invoiceLinkUpdates({}, chosen, urls)).toEqual({ ufCrmSmartInvoiceLink: urls.page, ufCrmSmartInvoiceQr: urls.qr })
    expect(invoiceLinkUpdates({ ufCrmSmartInvoiceLink: urls.page, ufCrmSmartInvoiceQr: 'old' }, chosen, urls)).toEqual({ ufCrmSmartInvoiceQr: urls.qr })
    expect(invoiceLinkUpdates({ ufCrmSmartInvoiceLink: urls.page, ufCrmSmartInvoiceQr: urls.qr }, chosen, urls)).toEqual({})
    expect(invoiceLinkUpdates({}, { linkField: '', qrField: '' }, urls)).toEqual({})
  })

  it('настройки: коды полей нормализуются, мусор — пусто', () => {
    const p = parseSettings({ publicPage: { linkField: 'uf_crm_smart_invoice_link', qrField: 'bad field!' } }).publicPage
    expect(p.linkField).toBe('UF_CRM_SMART_INVOICE_LINK')
    expect(p.qrField).toBe('')
  })
})
