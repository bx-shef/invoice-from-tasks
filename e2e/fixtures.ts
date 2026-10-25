import type { Page } from '@playwright/test'

// Подставной счёт для публичной страницы: форма ответа /api/public/invoice (shared/domain/publicInvoice).
export function sampleInvoice() {
  return {
    state: 'open',
    invoice: {
      title: 'Счёт №145', number: '70', date: '2026-10-01', stage: 'Согласование', currencyId: 'BYN',
      total: 606.9, company: 'ООО «Пример»', contacts: ['Иван Петров'], myCompany: 'ИП Исполнитель',
      truncated: false, documents: [{ id: 1, title: 'Акт 57', templateId: 1 }],
      rows: [
        { name: '[87-119884] Импорт банковских выписок', sum: 510, taskId: 87, clientTaskId: '119884' },
        { name: '[1241-119705] Отчёт план-факт', sum: 96.9, taskId: 1241, clientTaskId: '119705' }
      ],
      tasks: [
        { id: 87, title: 'Импорт выписок', description: 'Описание', results: ['Импорт работает'], url: '#', state: 'принята', date: '2026-09-20', clientTaskId: '119884', clientTaskUrl: null, clientTask: null },
        { id: 1241, title: 'Отчёт план-факт', description: 'Описание', results: [], url: '#', state: 'требует принятия', date: '2026-09-15', clientTaskId: '119705', clientTaskUrl: null, clientTask: null }
      ],
      approval: { comments: [], mark: { approved: false, approvedAt: null, enabled: true }, decisions: {} as Record<string, unknown> }
    }
  }
}

export type MockLog = { invoice: unknown[], decide: unknown[] }

export async function mockPublicApi(page: Page, inv = sampleInvoice()): Promise<MockLog> {
  const log: MockLog = { invoice: [], decide: [] }
  await page.route('**/api/public/invoice', (r) => {
    log.invoice.push(r.request().postDataJSON())
    return r.fulfill({ json: inv })
  })
  await page.route('**/api/public/document', r => r.abort())
  await page.route('**/api/public/decide', (r) => {
    const body = r.request().postDataJSON()
    log.decide.push(body)
    Object.assign(inv.invoice.approval.decisions, body?.decisions ?? {})
    return r.fulfill({ json: { ok: true } })
  })
  return log
}
