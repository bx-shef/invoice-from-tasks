import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptSecret, encryptSecret, loadEncKey } from '../../server/utils/secretCrypto'
import { getPortal, getPortalByDomain, refreshTokenOf, removePortal, saveInstall, updateTokens, type KeyValue } from '../../server/utils/tokenStore'
import { verifyInstallMember } from '../../server/utils/verifyInstallMember'

function memoryKv(): KeyValue & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async key => void data.delete(key)
  }
}

beforeEach(() => {
  vi.stubEnv('B24_TOKEN_ENC_KEY', randomBytes(32).toString('hex'))
})

describe('шифрование секретов', () => {
  it('туда и обратно; каждый раз новый шифртекст', () => {
    const a = encryptSecret('refresh-token')
    expect(a).not.toBe(encryptSecret('refresh-token'))
    expect(decryptSecret(a)).toBe('refresh-token')
  })

  it('чужой ключ не расшифрует — исключение, а не мусор', () => {
    const blob = encryptSecret('secret')
    expect(() => decryptSecret(blob, randomBytes(32))).toThrow()
  })

  it('без ключа в окружении — отказ, а не хранение открытым текстом', () => {
    expect(() => loadEncKey({})).toThrow(/not set/)
    expect(() => loadEncKey({ B24_TOKEN_ENC_KEY: 'short' })).toThrow(/32 bytes/)
  })
})

describe('хранилище установок', () => {
  const install = { memberId: 'M1', domain: 'Demo.bitrix24.ru', accessToken: 'AT', refreshToken: 'RT', expiresIn: 3600, applicationToken: 'app1' }

  it('сохраняет, находит по домену, шифрует refresh-токен', async () => {
    const kv = memoryKv()
    await saveInstall(kv, install, 1000)
    const byDomain = await getPortalByDomain(kv, 'demo.bitrix24.ru')
    expect(byDomain).toMatchObject({ memberId: 'm1', domain: 'demo.bitrix24.ru', expiresAt: 1000 + 3600_000 })
    expect(byDomain?.refreshTokenEnc).not.toContain('RT')
    expect(refreshTokenOf(byDomain!)).toBe('RT')
  })

  it('application_token пишется один раз — переустановка его не подменит', async () => {
    const kv = memoryKv()
    await saveInstall(kv, install)
    await saveInstall(kv, { ...install, applicationToken: 'attacker' })
    expect((await getPortal(kv, 'm1'))?.applicationToken).toBe('app1')
  })

  it('обновление токенов не воскрешает удалённый портал', async () => {
    const kv = memoryKv()
    await updateTokens(kv, 'ghost', { accessToken: 'x', refreshToken: 'y', expiresAt: 1 })
    expect(kv.data.size).toBe(0)
  })

  it('удаление стирает и запись, и индекс по домену', async () => {
    const kv = memoryKv()
    await saveInstall(kv, install)
    await removePortal(kv, 'M1')
    expect(kv.data.size).toBe(0)
  })

  it('переезд портала на новый домен убирает старый индекс', async () => {
    const kv = memoryKv()
    await saveInstall(kv, install)
    await saveInstall(kv, { ...install, domain: 'new.bitrix24.ru' })
    expect(await getPortalByDomain(kv, 'demo.bitrix24.ru')).toBeNull()
    expect(await getPortalByDomain(kv, 'new.bitrix24.ru')).not.toBeNull()
  })
})

describe('сверка member_id при установке', () => {
  it('совпал — отдаёт РОТИРОВАННЫЙ грант', async () => {
    const res = await verifyInstallMember('M1', 'rt', async () => ({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600, member_id: 'm1' }))
    expect(res).toEqual({ ok: true, grant: { accessToken: 'a2', refreshToken: 'r2', expiresIn: 3600 } })
  })

  it('грант другого портала — 403 (попытка отравить установку)', async () => {
    const res = await verifyInstallMember('victim', 'rt', async () => ({ access_token: 'a2', member_id: 'attacker' }))
    expect(res).toEqual({ ok: false, status: 403 })
  })

  it('поддельный грант — 403, сбой сети или нашей конфигурации — 503', async () => {
    expect((await verifyInstallMember('m', 'rt', async () => ({ error: 'invalid_grant' }))).status).toBe(403)
    expect((await verifyInstallMember('m', 'rt', async () => ({ error: 'invalid_client' }))).status).toBe(503)
    expect((await verifyInstallMember('m', 'rt', async () => {
      throw new Error('ECONNRESET')
    })).status).toBe(503)
    expect((await verifyInstallMember('m', 'rt', async () => 'not json')).status).toBe(503)
  })

  it('без refresh-токена сверять нечего — 403', async () => {
    expect((await verifyInstallMember('m', '', async () => ({}))).status).toBe(403)
  })
})
