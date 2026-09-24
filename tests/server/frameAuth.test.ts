import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractFrameAuth, isAuthRejection, resetFrameCache, verifyFrame, type VerifyDeps } from '../../server/utils/frameAuth'
import { saveInstall, type KeyValue } from '../../server/utils/tokenStore'

function memoryKv(): KeyValue {
  const data = new Map<string, unknown>()
  return {
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async key => void data.delete(key)
  }
}

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name] ?? null }
}

beforeEach(() => {
  vi.stubEnv('B24_TOKEN_ENC_KEY', randomBytes(32).toString('hex'))
  resetFrameCache()
})

async function installedKv(): Promise<KeyValue> {
  const kv = memoryKv()
  await saveInstall(kv, { memberId: 'm1', domain: 'demo.bitrix24.ru', accessToken: 'a', refreshToken: 'r', expiresIn: 3600, applicationToken: 't' })
  return kv
}

describe('extractFrameAuth', () => {
  it('берёт Bearer-токен и домен (в том числе с протоколом, как отдаёт SDK)', () => {
    expect(extractFrameAuth(headers({ 'authorization': 'Bearer tok', 'x-b24-domain': 'https://demo.bitrix24.ru' }), {}))
      .toEqual({ domain: 'demo.bitrix24.ru', accessToken: 'tok' })
  })

  it('чужой домен или нет токена — null', () => {
    expect(extractFrameAuth(headers({ 'authorization': 'Bearer tok', 'x-b24-domain': 'evil.com' }), {})).toBeNull()
    expect(extractFrameAuth(headers({ 'x-b24-domain': 'demo.bitrix24.ru' }), {})).toBeNull()
  })
})

describe('verifyFrame', () => {
  const auth = { domain: 'demo.bitrix24.ru', accessToken: 'tok' }

  it('портал без установки — 409, в портал даже не ходим', async () => {
    const call = vi.fn()
    const res = await verifyFrame(auth, { kv: memoryKv(), call })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(call).not.toHaveBeenCalled()
  })

  it('пользователь и признак администратора — из profile', async () => {
    const res = await verifyFrame(auth, { kv: await installedKv(), call: async () => ({ ID: '7', ADMIN: true }) })
    expect(res).toMatchObject({ ok: true, user: { userId: 7, isAdmin: true } })
  })

  it('токен чужого приложения на том же портале — 403', async () => {
    const deps: VerifyDeps = {
      kv: await installedKv(),
      appCode: 'local.ours',
      call: async (_d, _t, method) => (method === 'profile' ? { ID: 7 } : { CODE: 'local.other' })
    }
    expect(await verifyFrame(auth, deps)).toMatchObject({ ok: false, status: 403 })
  })

  it('отвергнутый токен — 401, сбой портала — 502', async () => {
    const kv = await installedKv()
    expect(await verifyFrame(auth, { kv, call: async () => {
      throw new Error('expired_token: The access token provided has expired')
    } })).toMatchObject({ status: 401 })
    resetFrameCache()
    expect(await verifyFrame(auth, { kv, call: async () => {
      throw new Error('ECONNRESET')
    } })).toMatchObject({ status: 502 })
  })

  it('кэширует решение по токену на минуту', async () => {
    const call = vi.fn(async () => ({ ID: 7 }))
    const kv = await installedKv()
    let now = 1_000
    await verifyFrame(auth, { kv, call, now: () => now })
    await verifyFrame(auth, { kv, call, now: () => now })
    expect(call).toHaveBeenCalledTimes(1)
    now += 61_000
    await verifyFrame(auth, { kv, call, now: () => now })
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('isAuthRejection отличает отказ от сбоя', () => {
    expect(isAuthRejection('NO_AUTH_FOUND: Wrong authorization data')).toBe(true)
    expect(isAuthRejection('503 Service Unavailable')).toBe(false)
  })
})
