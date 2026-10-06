import { describe, expect, it, vi } from 'vitest'
import { failNotice, loadPublicInvoice, postPublicApprove, postPublicComment, PROBLEM_FAILS_NOTICE, PUBLIC_FAILS_PER_INVOICE, type CommentDeps } from '../../server/utils/publicInvoice'
import type { PublicInvoiceView } from '#shared/domain/publicInvoice'

const CODE = 'ABCDEFGHJK'

interface Over { stage?: string, approved?: string, todoError?: string, updateError?: string, fields?: boolean }

/** Подставной портал: счёт 5 в стадии согласования DT31_1:S, компания с кодом, два дела и заметка. */
function portal(over: Over = {}) {
  const settings = JSON.stringify({
    publicPage: {
      stages: ['DT31_1:N'],
      approvalStage: 'DT31_1:S',
      closedText: 'Закрыто',
      ...(over.fields === false ? {} : { approvedField: 'UF_CRM_SMART_INVOICE_OK', approvedAtField: 'UF_CRM_SMART_INVOICE_OK_AT' })
    },
    problemChat: { dialogId: 'chat15', title: 'Проблемы' }
  })
  const writes: Array<[string, Record<string, unknown>]> = []
  const call = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === 'crm.item.get') {
      return { item: { id: 5, title: 'Счёт №5', stageId: over.stage ?? 'DT31_1:S', assignedById: 12, companyId: 3, contactIds: [], opportunity: 10, ufCrmSmartInvoiceOk: over.approved ?? 'N' } }
    }
    if (method === 'batch') {
      const cmd = params.cmd as Record<string, string>
      const result: Record<string, unknown> = {}
      for (const [key, c] of Object.entries(cmd)) {
        if (c.startsWith('crm.item.get')) result[key] = { item: { id: 3, title: 'ООО Клиент', ufCrmShIftAccessCode: CODE } }
        // Заметка есть только у дела 21.
        if (c.startsWith('crm.timeline.note.get') && c.includes('itemId=21')) result[key] = { text: 'Поправили' }
      }
      return { result }
    }
    if (method === 'app.option.get') return settings
    if (method === 'crm.status.list') return []
    if (method === 'crm.item.productrow.list') return { productRows: [] }
    if (method === 'crm.activity.list') return [
      { ID: '22', SUBJECT: 'Комментарий клиента: ООО Клиент', DESCRIPTION: 'Ещё вопрос', CREATED: '2026-10-06T11:00:00+03:00', COMPLETED: 'N' },
      { ID: '21', SUBJECT: 'Комментарий клиента: ООО Клиент', DESCRIPTION: 'Цена?', CREATED: '2026-10-06T10:00:00+03:00', COMPLETED: 'Y' }
    ]
    if (method === 'crm.activity.todo.add') {
      if (over.todoError) throw new Error(over.todoError)
      writes.push([method, params])
      return { id: 30 }
    }
    if (method === 'crm.item.update') {
      if (over.updateError) throw new Error(over.updateError)
      writes.push([method, params])
      return { item: {} }
    }
    throw new Error(`unexpected ${method}`)
  })
  return { call, writes }
}

function deps(p: ReturnType<typeof portal>, opts: { comments?: boolean } = {}) {
  const fails = new Map<string, number>()
  const notices: Array<[string, string]> = []
  const cache = new Map<string, PublicInvoiceView>()
  const d: CommentDeps & { notices: typeof notices } = {
    portal: async () => ({ call: p.call, origin: 'https://my.bitrix24.by' }),
    allowAttempt: () => true,
    locked: () => false,
    fail: (key) => {
      fails.set(key, (fails.get(key) ?? 0) + 1)
      return fails.get(key)!
    },
    cache: { get: k => cache.get(k), set: (k, v) => { cache.set(k, v) } },
    notify: async (_call, key, text) => {
      notices.push([key, text])
    },
    allowComment: () => opts.comments ?? true,
    now: () => new Date('2026-10-06T10:00:00Z'),
    notices
  }
  return d
}

const req = (over: Partial<{ code: string, text: unknown }> = {}) => ({ domain: 'my.bitrix24.by', invoiceId: 5, code: CODE, ip: '1.2.3.4', text: undefined as unknown, ...over })

describe('страница в стадии согласования', () => {
  it('открыта, хотя стадии нет в обычных; комментарии с ответом и отметкой «закрыто»', async () => {
    const r = await loadPublicInvoice(req(), deps(portal()))
    if (r.status !== 200 || r.body.state !== 'open') throw new Error('closed')
    expect(r.body.invoice.approval?.comments.map(c => [c.id, c.closed, c.answer])).toEqual([[22, false, null], [21, true, 'Поправили']])
    expect(r.body.invoice.approval?.mark).toEqual({ enabled: true, approved: false, approvedAt: null })
  })

  it('в обычной стадии согласования нет', async () => {
    const r = await loadPublicInvoice(req(), deps(portal({ stage: 'DT31_1:N' })))
    expect(r.status === 200 && r.body.state === 'open' && r.body.invoice.approval).toBeNull()
  })
})

describe('комментарий клиента', () => {
  it('дело на ответственного со сроком +1 час, автор — чей код подошёл', async () => {
    const p = portal()
    expect(await postPublicComment(req({ text: 'Поправьте цену' }), deps(p))).toEqual({ status: 200, body: { ok: true } })
    expect(p.writes).toEqual([['crm.activity.todo.add', expect.objectContaining({ ownerId: 5, responsibleId: 12, deadline: '2026-10-06T11:00:00.000Z', title: 'Комментарий клиента: ООО Клиент', description: 'Поправьте цену' })]])
  })

  it('не в стадии согласования — 403; пустой текст — 400; лимит — 429; ничего не пишется', async () => {
    const p = portal({ stage: 'DT31_1:N' })
    expect((await postPublicComment(req({ text: 'x' }), deps(p))).status).toBe(403)
    expect((await postPublicComment(req({ text: '  ' }), deps(portal()))).status).toBe(400)
    const limited = portal()
    expect((await postPublicComment(req({ text: 'x' }), deps(limited, { comments: false }))).status).toBe(429)
    expect([...p.writes, ...limited.writes]).toEqual([])
  })

  it('неверный код — 404, без записи', async () => {
    const p = portal()
    expect((await postPublicComment(req({ code: 'ZZZZZZZZZZ', text: 'x' }), deps(p))).status).toBe(404)
    expect(p.writes).toEqual([])
  })

  it('сбой записи — 503 и сообщение в чат проблем', async () => {
    const d = deps(portal({ todoError: 'ACCESS_DENIED' }))
    expect((await postPublicComment(req({ text: 'x' }), d)).status).toBe(503)
    await Promise.resolve()
    expect(d.notices[0]?.[1]).toMatch(/не записан[\s\S]*ACCESS_DENIED/)
  })
})

describe('кнопка «Согласовать»', () => {
  it('галка и момент — в счёт, дело — ответственному', async () => {
    const p = portal()
    expect(await postPublicApprove(req(), deps(p))).toEqual({ status: 200, body: { ok: true } })
    expect(p.writes[0]).toEqual(['crm.item.update', { entityTypeId: 31, id: 5, fields: { ufCrmSmartInvoiceOk: 'Y', ufCrmSmartInvoiceOkAt: '2026-10-06T10:00:00.000Z' } }])
    expect(p.writes[1]?.[1]).toMatchObject({ title: 'Счёт согласован клиентом: ООО Клиент', responsibleId: 12 })
  })

  it('уже согласовано — ничего не пишется; поля не выбраны — 403', async () => {
    const done = portal({ approved: 'Y' })
    expect((await postPublicApprove(req(), deps(done))).status).toBe(200)
    expect(done.writes).toEqual([])
    expect((await postPublicApprove(req(), deps(portal({ fields: false })))).status).toBe(403)
  })

  it('сбой записи счёта — 503 и сообщение в чат проблем', async () => {
    const d = deps(portal({ updateError: 'WRONG_FIELD' }))
    expect((await postPublicApprove(req(), d)).status).toBe(503)
    await Promise.resolve()
    expect(d.notices[0]?.[1]).toMatch(/Согласование счёта[\s\S]*WRONG_FIELD/)
  })
})

describe('чат проблем о неверных кодах', () => {
  it('сообщение на пороге и при блокировке, между ними — нет', () => {
    expect(failNotice(PROBLEM_FAILS_NOTICE - 1, 5, 'Счёт', '1.2.3.4')).toBeNull()
    expect(failNotice(PROBLEM_FAILS_NOTICE, 5, 'Счёт', '1.2.3.4')).toMatch(/Неверные коды[\s\S]*1\.2\.3\.4/)
    expect(failNotice(PROBLEM_FAILS_NOTICE + 1, 5, 'Счёт', '1.2.3.4')).toBeNull()
    expect(failNotice(PUBLIC_FAILS_PER_INVOICE.max, 5, 'Счёт', '1.2.3.4')).toMatch(/закрыта на час/)
  })

  it('пятый неверный код к счёту — сообщение в чат', async () => {
    const d = deps(portal())
    for (let i = 0; i < PROBLEM_FAILS_NOTICE; i++) await loadPublicInvoice(req({ code: 'ZZZZZZZZZZ' }), d)
    expect(d.notices).toHaveLength(1)
    expect(d.notices[0]?.[0]).toMatch(/:fails$/)
  })
})
