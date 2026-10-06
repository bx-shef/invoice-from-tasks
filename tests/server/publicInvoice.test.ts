import { describe, expect, it, vi } from 'vitest'
import { codeEquals, loadPublicInvoice, matchesClient, NOT_FOUND, type PublicDeps } from '../../server/utils/publicInvoice'
import { restCallFrom } from '../../server/utils/b24Client'

const CODE = 'ABCDEFGHJK'

function portal(over: { stage?: string, stages?: string[], companyCode?: string | null, contactCode?: string | null } = {}) {
  const settings = JSON.stringify({ publicPage: { stages: over.stages ?? ['DT31_1:N'], closedText: 'Обратитесь к менеджеру' }, clientFields: { task: '', companyDomain: 'UF_CRM_DOMAIN', contactDomain: '' } })
  const calls: string[] = []
  const call = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    calls.push(method)
    if (method === 'crm.item.get') {
      const { entityTypeId, id } = params as { entityTypeId: number, id: number }
      if (entityTypeId === 31) return id === 5 ? { item: { id: 5, title: 'Счёт №5', stageId: over.stage ?? 'DT31_1:N', begindate: '2026-10-01', currencyId: 'BYN', opportunity: 130, companyId: 3, contactIds: [7], mycompanyId: 1 } } : Promise.reject(new Error('NOT_FOUND'))
      if (entityTypeId === 4 && id === 3) return { item: { id: 3, title: 'ООО Клиент', ufCrmShIftAccessCode: over.companyCode === undefined ? CODE : over.companyCode, ufCrmDomain: 'client.bitrix24.ru' } }
      if (entityTypeId === 4 && id === 1) return { item: { id: 1, title: 'Мы' } }
      if (entityTypeId === 3) return { item: { id: 7, name: 'Иван', lastName: 'Петров', ufCrmShIftAccessCode: over.contactCode ?? null } }
    }
    if (method === 'app.option.get') return settings
    if (method === 'crm.status.list') return [{ STATUS_ID: 'DT31_1:N', NAME: 'Новый' }]
    if (method === 'crm.item.productrow.list') return { productRows: [{ id: 1, productName: '[10-77] Лендинг', price: 130, quantity: 1, sort: 10 }] }
    if (method === 'tasks.task.get') return { task: { id: 10, title: 'Лендинг', description: 'Описание' } }
    if (method === 'v3:tasks.task.result.list') return [{ text: 'Готово' }]
    throw new Error(`unexpected ${method}`)
  })
  return { call, calls }
}

function deps(p: ReturnType<typeof portal> | null, allow = true): PublicDeps {
  return { portal: async () => (p ? { call: p.call, origin: 'https://my.bitrix24.by' } : null), allow: () => allow }
}

const req = (over: Partial<{ domain: string, invoiceId: number, code: string }> = {}) => ({ domain: 'my.bitrix24.by', invoiceId: 5, code: CODE, ip: '1.2.3.4', ...over })

describe('loadPublicInvoice', () => {
  it('верный код компании — расшифровка: клиент, исполнитель, стадия, строки, задачи', async () => {
    const r = await loadPublicInvoice(req(), deps(portal()))
    expect(r.status).toBe(200)
    if (r.status !== 200 || r.body.state !== 'open') throw new Error('closed')
    expect(r.body.invoice).toMatchObject({ title: 'Счёт №5', stage: 'Новый', company: 'ООО Клиент', contacts: ['Иван Петров'], myCompany: 'Мы', total: 130 })
    expect(r.body.invoice.tasks[0]).toMatchObject({ id: 10, results: ['Готово'], clientTaskId: '77', clientTaskUrl: 'https://client.bitrix24.ru/company/personal/user/0/tasks/task/view/77/' })
  })

  it('код контакта тоже открывает', async () => {
    const r = await loadPublicInvoice(req(), deps(portal({ companyCode: null, contactCode: CODE })))
    expect(r.status).toBe(200)
  })

  it('неверный код, нет счёта, нет портала — один и тот же ответ 404; стадию не выдаём', async () => {
    const wrong = portal()
    for (const r of [
      await loadPublicInvoice(req({ code: 'ZZZZZZZZZZ' }), deps(wrong)),
      await loadPublicInvoice(req({ invoiceId: 6 }), deps(portal())),
      await loadPublicInvoice(req(), deps(null))
    ]) expect(r).toEqual({ status: 404, body: { error: NOT_FOUND } })
    expect(wrong.calls).not.toContain('crm.status.list')
    expect(wrong.calls).not.toContain('crm.item.productrow.list')
  })

  it('отозванный код (пусто у всех) — 404', async () => {
    const r = await loadPublicInvoice(req(), deps(portal({ companyCode: '', contactCode: null })))
    expect(r.status).toBe(404)
  })

  it('стадия не из настроек — спокойная фраза, без строк и задач', async () => {
    const p = portal({ stage: 'DT31_1:P' })
    const r = await loadPublicInvoice(req(), deps(p))
    expect(r).toEqual({ status: 200, body: { state: 'closed', text: 'Обратитесь к менеджеру' } })
    expect(p.calls).not.toContain('crm.item.productrow.list')
  })

  it('не похожее на код — 404 без обращения к порталу; лимит — 429 до портала', async () => {
    const p = portal()
    expect((await loadPublicInvoice(req({ code: 'abc' }), deps(p))).status).toBe(404)
    expect((await loadPublicInvoice(req(), deps(p, false))).status).toBe(429)
    expect(p.call).not.toHaveBeenCalled()
  })

  it('битая ссылка — 400', async () => {
    expect((await loadPublicInvoice(req({ invoiceId: 0 }), deps(portal()))).status).toBe(400)
  })
})

describe('сравнение кода', () => {
  it('в постоянное время, разная длина — не равно', () => {
    expect(codeEquals(CODE, CODE)).toBe(true)
    expect(codeEquals(CODE, 'ABCDEFGHJ')).toBe(false)
    expect(matchesClient(CODE, [{ kind: 'company', id: 1, title: '', accessCode: null, domain: null }, { kind: 'contact', id: 2, title: '', accessCode: CODE, domain: null }])).toBe(true)
    expect(matchesClient(CODE, [])).toBe(false)
  })
})

describe('RestCall: приставка v3', () => {
  it('v3: уходит в actions.v3 без приставки; без v3 в клиенте — ошибка', async () => {
    const ok = { isSuccess: true, getData: () => ({ result: 'r' }), getErrorMessages: () => [] }
    const v2 = vi.fn(async () => ok)
    const v3 = vi.fn(async () => ok)
    const call = restCallFrom({ actions: { v2: { call: { make: v2 } }, v3: { call: { make: v3 } } } })
    await call('v3:tasks.task.result.list', { a: 1 })
    expect(v3).toHaveBeenCalledWith({ method: 'tasks.task.result.list', params: { a: 1 } })
    await call('crm.item.get')
    expect(v2).toHaveBeenCalledWith({ method: 'crm.item.get', params: {} })
    await expect(restCallFrom({ actions: { v2: { call: { make: v2 } } } })('v3:x')).rejects.toThrow(/v3/)
  })
})
