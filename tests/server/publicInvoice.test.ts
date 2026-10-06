import { describe, expect, it, vi } from 'vitest'
import { batch, codeEquals, documentListParams, isNotFound, loadPublicDocument, loadPublicInvoice, matchesClient, NOT_FOUND, type DocumentDeps, type PublicDeps } from '../../server/utils/publicInvoice'
import { restCallFrom } from '../../server/utils/b24Client'
import { batchCommand, type PublicInvoiceView } from '#shared/domain/publicInvoice'
import { SlidingWindow } from '../../server/utils/rateLimit'

const CODE = 'ABCDEFGHJK'

interface Over { docsError?: string, templates?: number[], doc?: Record<string, unknown>, stage?: string, stages?: string[], companyCode?: string | null, contactCode?: string | null, taskBinding?: string[], invoiceError?: string }

/** Подставной портал: отвечает на одиночные вызовы и на `batch` (команды — строки запроса). */
function portal(over: Over = {}) {
  const settings = JSON.stringify({ publicPage: { stages: over.stages ?? ['DT31_1:N'], closedText: 'Обратитесь к менеджеру', templates: over.templates ?? [] }, clientFields: { task: '', taskDomain: 'UF_SOURCE_DOMAIN' } })
  const calls: string[] = []
  const item = (entityTypeId: number, id: number): unknown => {
    if (entityTypeId === 31) {
      if (over.invoiceError) throw new Error(over.invoiceError)
      if (id !== 5) throw new Error('crm.item.get: NOT_FOUND')
      return { item: { id: 5, title: 'Счёт №5', stageId: over.stage ?? 'DT31_1:N', begindate: '2026-10-01', currencyId: 'BYN', opportunity: 130, companyId: 3, contactIds: [7], mycompanyId: 1, parentId2: 9 } }
    }
    if (entityTypeId === 4 && id === 3) return { item: { id: 3, title: 'ООО Клиент', ufCrmShIftAccessCode: over.companyCode === undefined ? CODE : over.companyCode } }
    if (entityTypeId === 4 && id === 1) return { item: { id: 1, title: 'Мы' } }
    if (entityTypeId === 3) return { item: { id: 7, name: 'Иван', lastName: 'Петров', ufCrmShIftAccessCode: over.contactCode ?? null } }
    throw new Error('NOT_FOUND')
  }
  const task = (id: number) => ({ task: { id, title: 'Лендинг', description: 'Описание', ufCrmTask: over.taskBinding ?? ['D_9'], ufSourceDomain: 'client.bitrix24.ru' } })
  const call = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    calls.push(method)
    if (method === 'crm.item.get') return item(Number(params.entityTypeId), Number(params.id))
    if (method === 'batch') {
      const result: Record<string, unknown> = {}
      for (const [key, cmd] of Object.entries(params.cmd as Record<string, string>)) {
        const [m, q] = cmd.split('?') as [string, string]
        const p = new URLSearchParams(q)
        calls.push(`batch:${m}`)
        try {
          result[key] = m === 'crm.item.get' ? item(Number(p.get('entityTypeId')), Number(p.get('id'))) : task(Number(p.get('taskId')))
        } catch { /* ошибка команды — ключа нет, как у портала */ }
      }
      return { result }
    }
    if (method === 'app.option.get') return settings
    if (method === 'crm.status.list') return [{ STATUS_ID: 'DT31_1:N', NAME: 'Новый' }]
    if (method === 'crm.item.productrow.list') return { productRows: [{ id: 1, productName: '[10-77] Лендинг', price: 130, quantity: 1, sort: 10 }] }
    if (method === 'v3:tasks.task.result.list') return [{ text: 'Готово' }]
    if (method === 'crm.documentgenerator.document.list' && over.docsError) throw new Error(over.docsError)
    if (method === 'crm.documentgenerator.document.list') return { documents: [
      { id: '61', title: 'Счёт 5', templateId: '3', pdfId: '1', entityTypeId: '31', entityId: '5' },
      { id: '60', title: 'Старый счёт', templateId: '3', pdfId: '1', entityTypeId: '31', entityId: '5' },
      { id: '62', title: 'Акт', templateId: '4', pdfId: '1', entityTypeId: '31', entityId: '5' }
    ] }
    if (method === 'crm.documentgenerator.document.get') return { document: over.doc ?? { id: '61', title: 'Счёт 5', templateId: '3', pdfId: '1', entityTypeId: '31', entityId: '5', pdfUrlMachine: 'https://my.bitrix24.by/rest/crm.documentgenerator.document.getPdf.json?auth=T&token=X' } }
    throw new Error(`unexpected ${method}`)
  })
  return { call, calls }
}

function deps(p: ReturnType<typeof portal> | null, opts: { allow?: boolean } = {}) {
  const fails = new Map<string, number>()
  const cache = new Map<string, PublicInvoiceView>()
  const d: PublicDeps & { fails: Map<string, number>, cache2: Map<string, PublicInvoiceView> } = {
    portal: async () => (p ? { call: p.call, origin: 'https://my.bitrix24.by' } : null),
    allowAttempt: () => opts.allow ?? true,
    locked: key => (fails.get(key) ?? 0) >= 3,
    fail: (key) => { fails.set(key, (fails.get(key) ?? 0) + 1) },
    cache: { get: k => cache.get(k), set: (k, v) => { cache.set(k, v) } },
    fails,
    cache2: cache
  }
  return d
}

const req = (over: Partial<{ domain: string, invoiceId: number, code: string }> = {}) => ({ domain: 'my.bitrix24.by', invoiceId: 5, code: CODE, ip: '1.2.3.4', ...over })

describe('loadPublicInvoice', () => {
  it('верный код компании — расшифровка; до кода — 2 запроса (счёт и пакет клиентов)', async () => {
    const p = portal()
    const r = await loadPublicInvoice(req(), deps(p))
    if (r.status !== 200 || r.body.state !== 'open') throw new Error('closed')
    expect(r.body.invoice).toMatchObject({ title: 'Счёт №5', stage: 'Новый', company: 'ООО Клиент', contacts: ['Иван Петров'], myCompany: 'Мы', total: 130, truncated: false })
    expect(r.body.invoice.tasks[0]).toMatchObject({ id: 10, results: ['Готово'], clientTaskId: '77', clientTaskUrl: 'https://client.bitrix24.ru/company/personal/user/0/tasks/task/view/77/' })
    expect(p.calls.slice(0, 2)).toEqual(['crm.item.get', 'batch'])
    expect(p.calls.indexOf('app.option.get')).toBeGreaterThan(p.calls.indexOf('batch'))
  })

  it('код контакта тоже открывает', async () => {
    expect((await loadPublicInvoice(req(), deps(portal({ companyCode: null, contactCode: CODE })))).status).toBe(200)
  })

  it('задача из строки, не привязанная к счёту или его сделке, не показывается', async () => {
    const r = await loadPublicInvoice(req(), deps(portal({ taskBinding: ['D_999'] })))
    if (r.status !== 200 || r.body.state !== 'open') throw new Error('closed')
    expect(r.body.invoice.tasks).toEqual([])
    expect(r.body.invoice.rows).toHaveLength(1)
    const bound = await loadPublicInvoice(req(), deps(portal({ taskBinding: ['SI_5'] })))
    expect(bound.status === 200 && bound.body.state === 'open' && bound.body.invoice.tasks).toHaveLength(1)
  })

  it('неверный код, нет счёта, нет портала — один ответ 404; ни настроек, ни стадии, ни строк', async () => {
    const wrong = portal()
    for (const r of [
      await loadPublicInvoice(req({ code: 'ZZZZZZZZZZ' }), deps(wrong)),
      await loadPublicInvoice(req({ invoiceId: 6 }), deps(portal())),
      await loadPublicInvoice(req(), deps(null))
    ]) expect(r).toEqual({ status: 404, body: { error: NOT_FOUND } })
    expect(wrong.calls).toEqual(['crm.item.get', 'batch', 'batch:crm.item.get', 'batch:crm.item.get'])
  })

  it('сбой портала — не «неверный код», а ошибка (обработчик отдаст 503); неверный код не учтён', async () => {
    const d = deps(portal({ invoiceError: 'crm.item.get: QUERY_LIMIT_EXCEEDED' }))
    await expect(loadPublicInvoice(req(), d)).rejects.toThrow(/QUERY_LIMIT/)
    expect(d.fails.size).toBe(0)
  })

  it('учитываются только неверные коды; после лимита — 429 даже с верным; верный код счётчик не тратит', async () => {
    const d = deps(portal())
    for (let i = 0; i < 5; i++) await loadPublicInvoice(req(), d)
    expect(d.fails.size).toBe(0)
    for (let i = 0; i < 3; i++) await loadPublicInvoice(req({ code: 'ZZZZZZZZZZ' }), d)
    expect((await loadPublicInvoice(req(), d)).status).toBe(429)
  })

  it('отозванный код (пусто у всех) — 404', async () => {
    expect((await loadPublicInvoice(req(), deps(portal({ companyCode: '', contactCode: null })))).status).toBe(404)
  })

  it('стадия не из настроек — спокойная фраза, без строк и задач', async () => {
    const p = portal({ stage: 'DT31_1:P' })
    expect(await loadPublicInvoice(req(), deps(p))).toEqual({ status: 200, body: { state: 'closed', text: 'Обратитесь к менеджеру' } })
    expect(p.calls).not.toContain('crm.item.productrow.list')
  })

  it('кеш: повторное открытие не читает строки и задачи, но код проверяет', async () => {
    const p = portal()
    const d = deps(p)
    await loadPublicInvoice(req(), d)
    p.calls.length = 0
    expect((await loadPublicInvoice(req(), d)).status).toBe(200)
    expect(p.calls).not.toContain('crm.item.productrow.list')
    expect((await loadPublicInvoice(req({ code: 'ZZZZZZZZZZ' }), d)).status).toBe(404)
  })

  it('не похоже на код — 404 без портала; лимит попыток — 429 до портала; плохой домен — 400', async () => {
    const p = portal()
    expect((await loadPublicInvoice(req({ code: 'abc' }), deps(p))).status).toBe(404)
    expect((await loadPublicInvoice(req(), deps(p, { allow: false }))).status).toBe(429)
    expect(p.call).not.toHaveBeenCalled()
    expect((await loadPublicInvoice(req({ domain: 'x'.repeat(300) }), deps(p))).status).toBe(400)
    expect((await loadPublicInvoice(req({ domain: 'evil"\n.ru' }), deps(p))).status).toBe(400)
    expect((await loadPublicInvoice(req({ invoiceId: 0 }), deps(p))).status).toBe(400)
  })
})

describe('мелочи сервера', () => {
  it('сравнение кода в постоянное время и по всем клиентам', () => {
    expect(codeEquals(CODE, CODE)).toBe(true)
    expect(codeEquals(CODE, 'ABCDEFGHJ')).toBe(false)
    const a = { kind: 'company' as const, id: 1, title: '', accessCode: 'ZZZZZZZZZZ', domain: null }
    const b = { kind: 'contact' as const, id: 2, title: '', accessCode: CODE, domain: null }
    expect(matchesClient(CODE, [a, b])).toBe(true)
    expect(matchesClient(CODE, [b, a])).toBe(true)
    expect(matchesClient(CODE, [a])).toBe(false)
  })

  it('«не найдено» и «нет доступа» — 404, прочее — сбой', () => {
    expect(isNotFound(new Error('crm.item.get: NOT_FOUND'))).toBe(true)
    expect(isNotFound(new Error('ACCESS_DENIED'))).toBe(true)
    expect(isNotFound(new Error('fetch failed'))).toBe(false)
  })

  it('batch: пустой пакет — без запроса; ответ по ключам', async () => {
    const call = vi.fn(async () => ({ result: { a: 1 }, result_error: { b: 'x' } }))
    expect(await batch(call, {})).toEqual({})
    expect(call).not.toHaveBeenCalled()
    expect(await batch(call, { a: 'x' })).toEqual({ a: 1 })
  })

  it('команда пакета: массивы и вложенные объекты — как строка запроса портала', () => {
    expect(batchCommand('tasks.task.get', { taskId: 10, select: ['ID', 'UF_CRM_TASK'] })).toBe('tasks.task.get?taskId=10&select%5B%5D=ID&select%5B%5D=UF_CRM_TASK')
    expect(batchCommand('crm.item.list', { filter: { '=id': 3 } })).toBe('crm.item.list?filter%5B%3Did%5D=3')
  })

  it('SlidingWindow.used — без учёта новой попытки', () => {
    const w = new SlidingWindow()
    const lim = { max: 2, windowMs: 1000 }
    expect(w.used('k', lim, 0)).toBe(0)
    w.take([['k', lim]], 10)
    w.take([['k', lim]], 20)
    expect(w.used('k', lim, 30)).toBe(2)
    expect(w.used('k', lim, 1015)).toBe(1)
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

describe('документы (этап 5)', () => {
  const docDeps = (p: ReturnType<typeof portal>, pdf = '%PDF-1.4 ...') => {
    const fetchPdf = vi.fn(async () => new TextEncoder().encode(pdf))
    return { d: { ...deps(p), fetchPdf } as DocumentDeps, fetchPdf }
  }

  it('в расшифровке — последний документ по каждому разрешённому шаблону', async () => {
    const r = await loadPublicInvoice(req(), deps(portal({ templates: [3] })))
    if (r.status !== 200 || r.body.state !== 'open') throw new Error('closed')
    expect(r.body.invoice.documents).toEqual([{ id: 61, title: 'Счёт 5', templateId: 3 }])
    const none = portal()
    await loadPublicInvoice(req(), deps(none))
    expect(none.calls).not.toContain('crm.documentgenerator.document.list')
  })

  it('фильтр списка — документы этого счёта, новые первыми', () => {
    expect(documentListParams(5)).toMatchObject({ filter: { entityTypeId: 31, entityId: 5 }, order: { id: 'desc' } })
  })

  it('скачивание: код проверяется заново, файл — по машинной ссылке портала', async () => {
    const { d, fetchPdf } = docDeps(portal({ templates: [3] }))
    const r = await loadPublicDocument({ ...req(), documentId: 61 }, d)
    expect(r.status).toBe(200)
    expect('pdf' in r && r.fileName).toBe('Счёт 5.pdf')
    expect(fetchPdf).toHaveBeenCalledWith('https://my.bitrix24.by/rest/crm.documentgenerator.document.getPdf.json?auth=T&token=X')
    const wrong = docDeps(portal({ templates: [3] }))
    expect((await loadPublicDocument({ ...req({ code: 'ZZZZZZZZZZ' }), documentId: 61 }, wrong.d)).status).toBe(404)
    expect(wrong.fetchPdf).not.toHaveBeenCalled()
  })

  it('чужой счёт, неразрешённый шаблон, ссылка на другой хост, закрытая стадия — 404 без скачивания', async () => {
    const cases: Over[] = [
      { templates: [3], doc: { id: 61, templateId: 3, pdfId: 1, entityTypeId: 31, entityId: 999, pdfUrlMachine: 'https://my.bitrix24.by/x' } },
      { templates: [4], doc: { id: 61, templateId: 3, pdfId: 1, entityTypeId: 31, entityId: 5, pdfUrlMachine: 'https://my.bitrix24.by/x' } },
      { templates: [3], doc: { id: 61, templateId: 3, pdfId: 1, entityTypeId: 31, entityId: 5, pdfUrlMachine: 'https://evil.example/x' } },
      { templates: [3], doc: { id: 61, templateId: 3, pdfId: 1, entityTypeId: 2, entityId: 5, pdfUrlMachine: 'https://my.bitrix24.by/x' } },
      { templates: [3], stage: 'DT31_1:P' }
    ]
    for (const over of cases) {
      const { d, fetchPdf } = docDeps(portal(over))
      expect((await loadPublicDocument({ ...req(), documentId: 61 }, d)).status, JSON.stringify(over)).toBe(404)
      expect(fetchPdf).not.toHaveBeenCalled()
    }
    expect((await loadPublicDocument({ ...req(), documentId: 0 }, docDeps(portal()).d)).status).toBe(400)
  })

  it('старую версию документа (не последнюю по шаблону) скачать нельзя', async () => {
    const { d, fetchPdf } = docDeps(portal({ templates: [3], doc: { id: 60, title: 'Старый', templateId: 3, pdfId: 1, entityTypeId: 31, entityId: 5, pdfUrlMachine: 'https://my.bitrix24.by/x' } }))
    expect((await loadPublicDocument({ ...req(), documentId: 60 }, d)).status).toBe(404)
    expect(fetchPdf).not.toHaveBeenCalled()
  })

  it('сбой списка документов страницу не роняет — блок пуст', async () => {
    const r = await loadPublicInvoice(req(), deps(portal({ templates: [3], docsError: 'documentgenerator: OPERATION_TIME_LIMIT' })))
    expect(r.status === 200 && r.body.state === 'open' && r.body.invoice.documents).toEqual([])
  })

  it('портал вернул не PDF — ошибка (обработчик отдаст 503)', async () => {
    await expect(loadPublicDocument({ ...req(), documentId: 61 }, docDeps(portal({ templates: [3] }), '{"error":"x"}').d)).rejects.toThrow(/not a PDF/)
  })
})
