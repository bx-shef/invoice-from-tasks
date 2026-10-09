import { describe, expect, it, vi } from 'vitest'
import { callClientPortal, hookMethodUrl, readClientTasks, readLimited, type HookFetch, type HookResponse } from '../../server/utils/clientPortal'
import { attachClientTasks } from '../../server/utils/publicInvoice'
import { clientTaskIdFor, clientTaskState, httpsUrl, parseClientTask, parsePublicClient, portalImage, type PublicTask } from '#shared/domain/publicInvoice'

const HOOK = 'https://client.bitrix24.ru/rest/1/abc123def456/'

function respond(status: number, raw: string, contentLength?: number): HookResponse {
  const bytes = new TextEncoder().encode(raw)
  return {
    ok: status < 400,
    status,
    headers: { get: (n: string) => (n === 'content-length' && contentLength !== undefined ? String(contentLength) : null) },
    body: new ReadableStream({ start(c) {
      for (let i = 0; i < bytes.length; i += 65536) c.enqueue(bytes.slice(i, i + 65536))
      c.close()
    } })
  }
}

function fakeFetch(handler: (url: string, body: Record<string, unknown>) => { status?: number, body: unknown, raw?: string, contentLength?: number }): HookFetch & { urls: string[], inits: Array<{ body: string, redirect: string }> } {
  const urls: string[] = []
  const inits: Array<{ body: string, redirect: string }> = []
  const f = (async (url: string, init: { body: string, redirect: 'error' }) => {
    urls.push(url)
    inits.push(init)
    const r = handler(url, JSON.parse(init.body))
    return respond(r.status ?? 200, r.raw ?? JSON.stringify(r.body), r.contentLength)
  }) as unknown as HookFetch & { urls: string[], inits: Array<{ body: string, redirect: string }> }
  f.urls = urls
  f.inits = inits
  return f
}

const SIG = () => AbortSignal.timeout(5000)

describe('адреса и вызов портала клиента', () => {
  it('v2 — .json, v3 — /rest/api/; плохой вебхук — ошибка', () => {
    expect(hookMethodUrl(HOOK, 'batch')).toBe('https://client.bitrix24.ru/rest/1/abc123def456/batch.json')
    expect(hookMethodUrl(HOOK, 'tasks.task.result.list', true)).toBe('https://client.bitrix24.ru/rest/api/1/abc123def456/tasks.task.result.list')
    expect(() => hookMethodUrl('http://x/rest/1/a/', 'batch')).toThrow()
  })

  it('без редиректов и с таймаутом; ошибка портала, не-JSON и огромный ответ — исключение без адреса вебхука', async () => {
    const ok = fakeFetch(() => ({ body: { result: 42 } }))
    expect(await callClientPortal(ok, HOOK, 'm', {}, SIG())).toBe(42)
    expect(ok.inits[0]).toMatchObject({ method: 'POST', redirect: 'error' })
    const err = fakeFetch(() => ({ status: 401, body: { error: 'insufficient_scope' } }))
    await expect(callClientPortal(err, HOOK, 'm', {}, SIG())).rejects.toThrow(/insufficient_scope/)
    await expect(callClientPortal(err, HOOK, 'm', {}, SIG())).rejects.not.toThrow(/abc123def456/)
    // Ошибка v3 — объект: код, а не «[object Object]».
    await expect(callClientPortal(fakeFetch(() => ({ status: 403, body: { error: { code: 'ACCESS_DENIED', message: 'нет' } } })), HOOK, 'm', {}, SIG())).rejects.toThrow(/ACCESS_DENIED/)
    await expect(callClientPortal(fakeFetch(() => ({ body: null, raw: '<html>' })), HOOK, 'm', {}, SIG())).rejects.toThrow(/not JSON/)
    await expect(callClientPortal(fakeFetch(() => ({ body: null, raw: 'x'.repeat(2 * 1024 * 1024 + 1) })), HOOK, 'm', {}, SIG())).rejects.toThrow(/too large/)
    // Сеть упала — адрес вебхука (он в cause у fetch) в сообщение не попадает.
    const net = (async () => {
      throw new TypeError('fetch failed', { cause: new Error(HOOK) })
    }) as unknown as HookFetch
    const e = await callClientPortal(net, HOOK, 'm', {}, SIG()).catch((x: Error) => x)
    expect(String(e) + String((e as Error).cause)).not.toContain('abc123def456')
  })

  it('предел размера — потоком и по content-length, в байтах', async () => {
    await expect(readLimited(respond(200, 'ok', 10_000_000), 100)).rejects.toThrow(/too large/)
    await expect(readLimited(respond(200, 'я'.repeat(60)), 100)).rejects.toThrow(/too large/)
    expect(await readLimited(respond(200, 'я'.repeat(50)), 100)).toBe('я'.repeat(50))
  })

  it('задачи — одним пакетом, результаты — v3 на задачу; пропавшая задача — без строки', async () => {
    const f = fakeFetch((url) => {
      if (url.endsWith('batch.json')) return { body: { result: { result: { t7: { task: { id: '7', title: 'Клиентская', status: '5', closedDate: '2026-10-06T14:18:25+03:00', creator: { name: 'Андрей', icon: 'https://cdn/x.png' } } } } } } }
      return { body: { result: { items: [{ id: 1, text: 'Принято' }] } } }
    })
    const got = await readClientTasks(f, HOOK, [7, 8, 7])
    expect([...got.keys()]).toEqual([7])
    // Аватар с чужого хоста (cdn) — нет: только с самого портала клиента.
    expect(got.get(7)).toEqual({ title: 'Клиентская', description: '', results: ['Принято'], creatorName: 'Андрей', creatorIcon: null, state: 'принята', acceptedAt: '2026-10-06' })
    expect(f.urls.filter(u => u.endsWith('batch.json'))).toHaveLength(1)
    const batchBody = JSON.parse(f.inits[0]!.body) as { halt: number, cmd: Record<string, string> }
    expect(batchBody.halt).toBe(0)
    expect(decodeURIComponent(batchBody.cmd.t7!)).toBe('tasks.task.get?taskId=7&select[]=ID&select[]=TITLE&select[]=DESCRIPTION&select[]=STATUS&select[]=CLOSED_DATE&select[]=CREATED_BY')
    expect(JSON.parse(f.inits.at(-1)!.body)).toEqual({ filter: [['taskId', '=', 7]], select: ['id', 'text'], order: { id: 'desc' }, pagination: { limit: 20 } })
    expect(await readClientTasks(f, HOOK, [])).toEqual(new Map())
  })

  it('не больше 20 задач за раз', async () => {
    const f = fakeFetch(() => ({ body: { result: { result: {} } } }))
    await readClientTasks(f, HOOK, Array.from({ length: 25 }, (_, i) => i + 1))
    expect(Object.keys((JSON.parse(f.inits[0]!.body) as { cmd: object }).cmd)).toHaveLength(20)
  })

  it('общий дедлайн: медленный портал не держит страницу дольше дедлайна', async () => {
    const slow = (async (_u: string, init: { signal: AbortSignal }) => new Promise((_r, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')))
    })) as unknown as HookFetch
    const t = Date.now()
    await expect(readClientTasks(slow, HOOK, [1], 100)).rejects.toThrow(/TimeoutError/)
    expect(Date.now() - t).toBeLessThan(2000)
  })
})

describe('задача клиента — разбор недоверенного ответа', () => {
  it('состояние словами владельца', () => {
    expect([5, 4, 1, 2, 3, 6, 9, null].map(clientTaskState)).toEqual(['принята', 'требует принятия', 'поставлена', 'поставлена', 'выполняется', 'отложена', 'статус 9', 'неизвестно'])
  })

  it('картинка — только https; дата принятия — только у завершённой', () => {
    expect(httpsUrl('javascript:alert(1)')).toBeNull()
    expect(httpsUrl('http://x/a.png')).toBeNull()
    expect(httpsUrl('https://u:p@x/a.png')).toBeNull()
    expect(httpsUrl('https://x/a.png')).toBe('https://x/a.png')
    expect(parseClientTask({ task: { id: 1, status: '4', closedDate: '2026-10-06T00:00:00' } }, null)?.acceptedAt).toBeNull()
    // Текст — без BB-кода; HTML не исполняется: страница выводит текстом (экранирует Vue).
    expect(parseClientTask({ task: { id: 1, title: '[B]x[/B]', creator: { name: '<b>И</b>', icon: 'data:x' } } }, [], 'c.ru')).toMatchObject({ title: 'x', creatorName: '<b>И</b>', creatorIcon: null })
    expect(parseClientTask({ task: { id: 1, title: 'я'.repeat(600), creator: { name: 'и'.repeat(300) } } }, { items: Array.from({ length: 30 }, () => ({ text: 'r' })) })).toMatchObject({ title: 'я'.repeat(500), creatorName: 'и'.repeat(200), results: Array.from({ length: 20 }, () => 'r') })
    expect(parseClientTask({ task: {} }, null)).toBeNull()
  })

  it('аватар — только с самого портала клиента; относительный путь — от него', () => {
    expect(portalImage('/upload/a.png', 'c.bitrix24.ru')).toBe('https://c.bitrix24.ru/upload/a.png')
    expect(portalImage('https://c.bitrix24.ru/a.png', 'c.bitrix24.ru')).toBe('https://c.bitrix24.ru/a.png')
    expect(portalImage('https://tracker.example/p.gif', 'c.bitrix24.ru')).toBeNull()
    expect(portalImage('//tracker.example/p.gif', 'c.bitrix24.ru')).toBeNull()
    expect(portalImage('/a.png', '')).toBeNull()
  })

  it('номер задачи клиента: поле выбрано — только из поля задачи, название строки не в счёт', () => {
    const rows = [{ name: '[10-999] x', sum: 1, taskId: 10, clientTaskId: '999' }]
    expect(clientTaskIdFor(rows, 10, { task: { ufSourceTaskId: 120836 } }, 'UF_SOURCE_TASK_ID')).toBe('120836')
    expect(clientTaskIdFor(rows, 10, { task: {} }, 'UF_SOURCE_TASK_ID')).toBeNull()
    expect(clientTaskIdFor(rows, 10, { task: {} }, '')).toBe('999')
  })

  it('вебхук клиента читается из поля компании/контакта как есть', () => {
    expect(parsePublicClient('company', { item: { id: 3, ufCrmShIftClientHook: 'ift1|c.ru|x' } }, 'UF_CRM_SH_IFT_ACCESS_CODE')?.hook).toBe('ift1|c.ru|x')
    expect(parsePublicClient('company', { item: { id: 3 } }, 'UF_CRM_SH_IFT_ACCESS_CODE')?.hook).toBeNull()
  })
})

describe('attachClientTasks', () => {
  const task = (clientTaskId: string, host: string | null): PublicTask => ({ id: 1, title: '', description: '', results: [], state: '', date: '', url: '', clientTaskId, clientTaskUrl: host ? `https://${host}/company/personal/user/0/tasks/task/view/${clientTaskId}/` : null })
  const client = (hook: string | null) => ({ kind: 'company' as const, id: 3, title: '', accessCode: null, hook })
  const view = { title: 'К', description: '', results: [], creatorName: '', creatorIcon: null, state: 'принята', acceptedAt: null }

  it('вебхук берётся только того портала, чей домен в задаче; ID — только числовые', async () => {
    const tasks = [task('7', 'client.bitrix24.ru'), task('8', 'other.bitrix24.ru'), task('CL_1', 'client.bitrix24.ru')]
    const clientTasks = vi.fn(async (_h: string, _d: string, ids: number[]) => ({ host: 'client.bitrix24.ru', tasks: new Map(ids.map(i => [i, view])) }))
    await attachClientTasks(tasks, [client('ift1|client.bitrix24.ru|s'), client(null)], 'my.bitrix24.by', { clientTasks })
    expect(clientTasks).toHaveBeenCalledTimes(1)
    expect(clientTasks).toHaveBeenCalledWith('ift1|client.bitrix24.ru|s', 'my.bitrix24.by', [7])
    expect(tasks.map(t => t.clientTask?.title ?? null)).toEqual(['К', null, null])
  })

  it('портал упал — второй вебхук того же портала не пробуем (дедлайн не ждём дважды)', async () => {
    const clientTasks = vi.fn(async () => {
      throw new Error('down')
    })
    const tasks = [task('7', 'client.bitrix24.ru')]
    await attachClientTasks(tasks, [client('ift1|client.bitrix24.ru|a'), client('ift1|client.bitrix24.ru|b')], 'my.bitrix24.by', { clientTasks })
    expect(clientTasks).toHaveBeenCalledTimes(1)
    expect(tasks[0]!.clientTask).toBeUndefined()
  })

  it('задачи нет в ответе портала — блок клиента явно пустой (null)', async () => {
    const tasks = [task('7', 'client.bitrix24.ru')]
    await attachClientTasks(tasks, [client('ift1|client.bitrix24.ru|a')], 'my.bitrix24.by', { clientTasks: async () => ({ host: 'client.bitrix24.ru', tasks: new Map() }) })
    expect(tasks[0]!.clientTask).toBeNull()
  })

  it('вебхук не открылся или открылся на чужой домен, портал упал — задачи без блока клиента', async () => {
    for (const clientTasks of [
      async () => null,
      async () => ({ host: 'evil.bitrix24.ru', tasks: new Map([[7, view]]) }),
      async () => { throw new Error('down') }
    ]) {
      const tasks = [task('7', 'client.bitrix24.ru')]
      await attachClientTasks(tasks, [client('ift1|client.bitrix24.ru|s')], 'my.bitrix24.by', { clientTasks })
      expect(tasks[0]!.clientTask ?? null).toBeNull()
    }
  })

  it('этап выключен (нет зависимости) — ничего не делает', async () => {
    const tasks = [task('7', 'client.bitrix24.ru')]
    await attachClientTasks(tasks, [client('ift1|client.bitrix24.ru|s')], 'my.bitrix24.by', {})
    expect(tasks[0]!.clientTask).toBeUndefined()
  })
})
