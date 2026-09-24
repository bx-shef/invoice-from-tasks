import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleB24Event, type EventDeps } from '../../server/utils/b24EventsHandler'
import { accessTokenOf, getPortal, getPortalByDomain, refreshTokenOf, saveInstall, type KeyValue } from '../../server/utils/tokenStore'

function memoryKv(): KeyValue & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async key => void data.delete(key)
  }
}

/** Тело события в той же PHP-скобочной форме, в какой его шлёт портал. */
function body(event: string, auth: Record<string, string>): string {
  const form = new URLSearchParams({ event })
  for (const [k, v] of Object.entries(auth)) form.set(`auth[${k}]`, v)
  return form.toString()
}

const installAuth = {
  domain: 'demo.bitrix24.ru',
  member_id: 'm1',
  application_token: 'app-secret',
  access_token: 'sent-access',
  refresh_token: 'sent-refresh',
  expires_in: '3600'
}

/** OAuth-сервер, который знает один настоящий грант: портал m1 на demo.bitrix24.ru. */
const realGrant = { access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, member_id: 'm1', client_endpoint: 'https://demo.bitrix24.ru/rest/' }

function deps(over: Partial<EventDeps> = {}): EventDeps & { kv: ReturnType<typeof memoryKv>, lines: string[] } {
  const lines: string[] = []
  return {
    kv: memoryKv(),
    envToken: '',
    creds: { clientId: 'cid', clientSecret: 'csecret' },
    refresh: vi.fn(async () => realGrant),
    log: line => lines.push(line),
    ...over,
    lines
  } as EventDeps & { kv: ReturnType<typeof memoryKv>, lines: string[] }
}

beforeEach(() => {
  vi.stubEnv('B24_TOKEN_ENC_KEY', randomBytes(32).toString('hex'))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('события, которые мы не обрабатываем', () => {
  it('чужое или пустое событие — 200 и ничего не меняем', async () => {
    const d = deps()
    expect(await handleB24Event(body('ONCRMDEALUPDATE', installAuth), d)).toEqual({ status: 200, body: { ok: true, ignored: 'ONCRMDEALUPDATE' } })
    expect(await handleB24Event('', d)).toEqual({ status: 200, body: { ok: true, ignored: 'empty' } })
    expect(d.kv.data.size).toBe(0)
  })
})

describe('установка (ONAPPINSTALL)', () => {
  it('сохраняет РОТИРОВАННЫЕ токены и домен из гранта; в журнале нет токенов', async () => {
    const d = deps()
    const res = await handleB24Event(body('ONAPPINSTALL', installAuth), d)
    expect(res).toEqual({ status: 200, body: { ok: true } })
    expect(d.refresh).toHaveBeenCalledWith('sent-refresh')
    const saved = (await getPortalByDomain(d.kv, 'demo.bitrix24.ru'))!
    expect(accessTokenOf(saved)).toBe('rotated-access')
    expect(refreshTokenOf(saved)).toBe('rotated-refresh')
    expect(saved.applicationToken).toBe('app-secret')
    expect(d.lines.join('\n')).not.toMatch(/access|refresh|app-secret/)
  })

  it('без auth, без member_id или с доменом не Битрикс24 — 400, в OAuth не ходим', async () => {
    const d = deps()
    expect((await handleB24Event('event=ONAPPINSTALL', d)).status).toBe(400)
    expect((await handleB24Event(body('ONAPPINSTALL', { ...installAuth, member_id: '' }), d)).status).toBe(400)
    expect((await handleB24Event(body('ONAPPINSTALL', { ...installAuth, domain: 'evil.com' }), d)).status).toBe(400)
    expect(d.refresh).not.toHaveBeenCalled()
    expect(d.kv.data.size).toBe(0)
  })

  it('токен приложения не совпал с B24_APPLICATION_TOKEN — 403', async () => {
    const d = deps({ envToken: 'expected' })
    expect((await handleB24Event(body('ONAPPINSTALL', installAuth), d)).status).toBe(403)
    expect(d.kv.data.size).toBe(0)
  })

  it('без B24_CLIENT_ID/SECRET установка НЕ сохраняется — 503 (fail-closed)', async () => {
    const d = deps({ creds: { clientId: '', clientSecret: '' } })
    expect((await handleB24Event(body('ONAPPINSTALL', installAuth), d)).status).toBe(503)
    expect(d.refresh).not.toHaveBeenCalled()
    expect(d.kv.data.size).toBe(0)
  })

  it('чужой member_id со своим грантом — 403, запись жертвы не тронута', async () => {
    const d = deps()
    await saveInstall(d.kv, { memberId: 'victim', domain: 'victim.bitrix24.ru', accessToken: 'va', refreshToken: 'vr', expiresIn: 3600, applicationToken: 'vt' })
    const res = await handleB24Event(body('ONAPPINSTALL', { ...installAuth, member_id: 'victim', domain: 'victim.bitrix24.ru' }), d)
    expect(res.status).toBe(403)
    expect(accessTokenOf((await getPortal(d.kv, 'victim'))!)).toBe('va')
  })

  it('свой member_id, но домен жертвы — 403, индекс домена жертвы не перехвачен', async () => {
    const d = deps()
    await saveInstall(d.kv, { memberId: 'victim', domain: 'victim.bitrix24.ru', accessToken: 'va', refreshToken: 'vr', expiresIn: 3600, applicationToken: 'vt' })
    const res = await handleB24Event(body('ONAPPINSTALL', { ...installAuth, domain: 'victim.bitrix24.ru' }), d)
    expect(res.status).toBe(403)
    expect((await getPortalByDomain(d.kv, 'victim.bitrix24.ru'))?.memberId).toBe('victim')
    expect(await getPortal(d.kv, 'm1')).toBeNull()
  })

  it('OAuth недоступен — 503, ничего не сохранено', async () => {
    const d = deps({ refresh: async () => {
      throw new Error('ECONNRESET')
    } })
    expect((await handleB24Event(body('ONAPPINSTALL', installAuth), d)).status).toBe(503)
    expect(d.kv.data.size).toBe(0)
  })

  it('переустановка не подменяет application_token', async () => {
    const d = deps()
    await handleB24Event(body('ONAPPINSTALL', installAuth), d)
    await handleB24Event(body('ONAPPINSTALL', { ...installAuth, application_token: 'other' }), d)
    expect((await getPortal(d.kv, 'm1'))?.applicationToken).toBe('app-secret')
  })
})

describe('удаление (ONAPPUNINSTALL)', () => {
  const uninstall = (token: string) => body('ONAPPUNINSTALL', { domain: 'demo.bitrix24.ru', member_id: 'm1', application_token: token })

  it('верный токен — запись и индекс удалены', async () => {
    const d = deps()
    await handleB24Event(body('ONAPPINSTALL', installAuth), d)
    expect(await handleB24Event(uninstall('app-secret'), d)).toEqual({ status: 200, body: { ok: true } })
    expect(d.kv.data.size).toBe(0)
  })

  it('чужой токен — 403, запись на месте', async () => {
    const d = deps()
    await handleB24Event(body('ONAPPINSTALL', installAuth), d)
    expect((await handleB24Event(uninstall('guess'), d)).status).toBe(403)
    expect(await getPortal(d.kv, 'm1')).not.toBeNull()
  })

  it('портал нам неизвестен и токена в окружении нет — 503, а не «удалим на слово»', async () => {
    expect((await handleB24Event(uninstall('any'), deps())).status).toBe(503)
  })
})
