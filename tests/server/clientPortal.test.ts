import { describe, expect, it, vi } from 'vitest'
import { callClientPortal, hookMethodUrl, readClientTasks, type HookFetch } from '../../server/utils/clientPortal'
import { attachClientTasks } from '../../server/utils/publicInvoice'
import { clientTaskState, httpsUrl, parseClientTask, parsePublicClient, type PublicTask } from '#shared/domain/publicInvoice'

const HOOK = 'https://client.bitrix24.ru/rest/1/abc123def456/'

function fakeFetch(handler: (url: string, body: Record<string, unknown>) => { status?: number, body: unknown, raw?: string }): HookFetch & { urls: string[], inits: unknown[] } {
  const urls: string[] = []
  const inits: unknown[] = []
  const f = (async (url, init) => {
    urls.push(url)
    inits.push(init)
    const r = handler(url, JSON.parse(init.body))
    const status = r.status ?? 200
    return { ok: status < 400, status, text: async () => r.raw ?? JSON.stringify(r.body) }
  }) as HookFetch & { urls: string[], inits: unknown[] }
  f.urls = urls
  f.inits = inits
  return f
}

describe('адреса и вызов портала клиента', () => {
  it('v2 — .json, v3 — /rest/api/; плохой вебхук — ошибка', () => {
    expect(hookMethodUrl(HOOK, 'batch')).toBe('https://client.bitrix24.ru/rest/1/abc123def456/batch.json')
    expect(hookMethodUrl(HOOK, 'tasks.task.result.list', true)).toBe('https://client.bitrix24.ru/rest/api/1/abc123def456/tasks.task.result.list')
    expect(() => hookMethodUrl('http://x/rest/1/a/', 'batch')).toThrow()
  })

  it('без редиректов и с таймаутом; ошибка портала, не-JSON и огромный ответ — исключение без адреса вебхука', async () => {
    const ok = fakeFetch(() => ({ body: { result: 42 } }))
    expect(await callClientPortal(ok, HOOK, 'm', {})).toBe(42)
    expect(ok.inits[0]).toMatchObject({ method: 'POST', redirect: 'error' })
    const err = fakeFetch(() => ({ status: 401, body: { error: 'insufficient_scope' } }))
    await expect(callClientPortal(err, HOOK, 'm', {})).rejects.toThrow(/insufficient_scope/)
    await expect(callClientPortal(err, HOOK, 'm', {})).rejects.not.toThrow(/abc123def456/)
    await expect(callClientPortal(fakeFetch(() => ({ body: null, raw: '<html>' })), HOOK, 'm', {})).rejects.toThrow(/not JSON/)
    await expect(callClientPortal(fakeFetch(() => ({ body: null, raw: 'x'.repeat(2 * 1024 * 1024 + 1) })), HOOK, 'm', {})).rejects.toThrow(/too large/)
  })

  it('задачи — одним пакетом, результаты — v3 на задачу; пропавшая задача — без строки', async () => {
    const f = fakeFetch((url) => {
      if (url.endsWith('batch.json')) return { body: { result: { result: { t7: { task: { id: '7', title: 'Клиентская', status: '5', closedDate: '2026-10-06T14:18:25+03:00', creator: { name: 'Андрей', icon: 'https://cdn/x.png' } } } } } } }
      return { body: { result: { items: [{ id: 1, text: 'Принято' }] } } }
    })
    const got = await readClientTasks(f, HOOK, [7, 8, 7])
    expect([...got.keys()]).toEqual([7])
    expect(got.get(7)).toEqual({ title: 'Клиентская', description: '', results: ['Принято'], creatorName: 'Андрей', creatorIcon: 'https://cdn/x.png', state: 'принята', acceptedAt: '2026-10-06' })
    expect(f.urls.filter(u => u.endsWith('batch.json'))).toHaveLength(1)
    expect(await readClientTasks(f, HOOK, [])).toEqual(new Map())
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
    expect(parseClientTask({ task: { id: 1, title: '[B]x[/B]', creator: { name: '<b>И</b>', icon: 'data:x' } } }, [])).toMatchObject({ title: 'x', creatorName: '<b>И</b>', creatorIcon: null })
    expect(parseClientTask({ task: {} }, null)).toBeNull()
  })

  it('вебхук клиента читается из поля компании/контакта как есть', () => {
    expect(parsePublicClient('company', { item: { id: 3, ufCrmShIftClientHook: 'ift1|c.ru|x' } }, 'UF_CRM_SH_IFT_ACCESS_CODE')?.hook).toBe('ift1|c.ru|x')
    expect(parsePublicClient('company', { item: { id: 3 } }, 'UF_CRM_SH_IFT_ACCESS_CODE')?.hook).toBeNull()
  })
})

describe('attachClientTasks', () => {
  const task = (clientTaskId: string, host: string | null): PublicTask => ({ id: 1, title: '', description: '', results: [], url: '', clientTaskId, clientTaskUrl: host ? `https://${host}/company/personal/user/0/tasks/task/view/${clientTaskId}/` : null })
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
