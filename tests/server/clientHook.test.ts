import { describe, expect, it } from 'vitest'
import { openClientHook, sealClientHook } from '../../server/utils/clientHook'
import { loadEncKey } from '../../server/utils/secretCrypto'

const KEY = 'a'.repeat(64)
const env = { CLIENT_HOOK_ENC_KEY: KEY }
const HOOK = 'https://client.bitrix24.ru/rest/1/abc123def456/'

describe('sealClientHook', () => {
  it('шифрует своим ключом; домен — открыто; вебхук в значении не виден', () => {
    const r = sealClientHook(HOOK, 'my.bitrix24.by', env)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.startsWith('ift1|client.bitrix24.ru|')).toBe(true)
    expect(r.value).not.toContain('abc123def456')
    expect(openClientHook(r.value, 'my.bitrix24.by', env)).toMatchObject({ url: HOOK, host: 'client.bitrix24.ru' })
  })

  it('не вебхук — 400; внутренний домен — 400 (SSRF); нет ключа — 503', () => {
    for (const bad of ['localhost', '127.0.0.1', '10.0.0.5', 'redis', 'svc.internal', 'nas.local', '[::1]']) {
      expect(sealClientHook(`https://${bad}/rest/1/abc123def456/`, 'my.bitrix24.by', env)).toMatchObject({ ok: false, status: 400 })
    }
    expect(sealClientHook('https://127.0.0.1/rest/1/abc123def456/', 'my.bitrix24.by', env)).toMatchObject({ ok: false, status: 400 })
    expect(sealClientHook('x', 'my.bitrix24.by', env)).toMatchObject({ ok: false, status: 400 })
    expect(sealClientHook(HOOK, 'my.bitrix24.by', {})).toMatchObject({ ok: false, status: 503 })
  })

  it('ключ токенов установки вебхуки не открывает', () => {
    const r = sealClientHook(HOOK, 'my.bitrix24.by', env)
    if (!r.ok) throw new Error('seal failed')
    expect(() => openClientHook(r.value, 'my.bitrix24.by', { CLIENT_HOOK_ENC_KEY: 'b'.repeat(64) })).toThrow()
  })

  it('подмена домена в открытой части — ошибка', () => {
    const r = sealClientHook(HOOK, 'my.bitrix24.by', env)
    if (!r.ok) throw new Error('seal failed')
    const forged = r.value.replace('client.bitrix24.ru', 'other.bitrix24.ru')
    // Домен входит в AAD — подмену отсекает уже GCM, до сверки доменов.
    expect(() => openClientHook(forged, 'my.bitrix24.by', env)).toThrow()
  })
})

describe('привязка к порталу и проверка домена при использовании', () => {
  it('значение, скопированное в другой портал, не открывается', () => {
    const r = sealClientHook(HOOK, 'my.bitrix24.by', env)
    if (!r.ok) throw new Error('seal failed')
    expect(() => openClientHook(r.value, 'other.bitrix24.by', env)).toThrow()
    expect(openClientHook(r.value, 'MY.bitrix24.by', env).host).toBe('client.bitrix24.ru')
  })

  it('коробка клиента на своём домене принимается без белого списка', () => {
    const r = sealClientHook('https://portal.standartno.by/rest/1/abc123def456/', 'my.bitrix24.by', env)
    if (!r.ok) throw new Error('seal failed')
    expect(openClientHook(r.value, 'my.bitrix24.by', env).host).toBe('portal.standartno.by')
  })
})

describe('loadEncKey: имя переменной', () => {
  it('читает указанную переменную и называет её в ошибке', () => {
    expect(loadEncKey(env, 'CLIENT_HOOK_ENC_KEY')).toHaveLength(32)
    expect(() => loadEncKey({}, 'CLIENT_HOOK_ENC_KEY')).toThrow(/CLIENT_HOOK_ENC_KEY/)
    expect(() => loadEncKey({})).toThrow(/B24_TOKEN_ENC_KEY/)
  })
})
