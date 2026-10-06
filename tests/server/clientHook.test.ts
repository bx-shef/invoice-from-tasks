import { describe, expect, it } from 'vitest'
import { openClientHook, sealClientHook } from '../../server/utils/clientHook'
import { loadEncKey } from '../../server/utils/secretCrypto'

const KEY = 'a'.repeat(64)
const env = { CLIENT_HOOK_ENC_KEY: KEY }
const HOOK = 'https://client.bitrix24.ru/rest/1/abc123def456/'

describe('sealClientHook', () => {
  it('шифрует своим ключом; домен — открыто; вебхук в значении не виден', () => {
    const r = sealClientHook(HOOK, env)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.startsWith('ift1|client.bitrix24.ru|')).toBe(true)
    expect(r.value).not.toContain('abc123def456')
    expect(openClientHook(r.value, env)).toEqual({ url: HOOK, host: 'client.bitrix24.ru' })
  })

  it('не вебхук — 400; не портал Битрикс24 — 400 (SSRF); нет ключа — 503', () => {
    expect(sealClientHook('https://evil.example.com/rest/1/abc123def456/', env)).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/не портал/) })
    expect(sealClientHook('https://127.0.0.1/rest/1/abc123def456/', env)).toMatchObject({ ok: false, status: 400 })
    expect(sealClientHook('x', env)).toMatchObject({ ok: false, status: 400 })
    expect(sealClientHook(HOOK, {})).toMatchObject({ ok: false, status: 503 })
  })

  it('ключ токенов установки вебхуки не открывает', () => {
    const r = sealClientHook(HOOK, env)
    if (!r.ok) throw new Error('seal failed')
    expect(() => openClientHook(r.value, { CLIENT_HOOK_ENC_KEY: 'b'.repeat(64) })).toThrow()
  })

  it('подмена домена в открытой части — ошибка', () => {
    const r = sealClientHook(HOOK, env)
    if (!r.ok) throw new Error('seal failed')
    const forged = r.value.replace('client.bitrix24.ru', 'other.bitrix24.ru')
    expect(() => openClientHook(forged, env)).toThrow(/host mismatch/)
  })
})

describe('loadEncKey: имя переменной', () => {
  it('читает указанную переменную и называет её в ошибке', () => {
    expect(loadEncKey(env, 'CLIENT_HOOK_ENC_KEY')).toHaveLength(32)
    expect(() => loadEncKey({}, 'CLIENT_HOOK_ENC_KEY')).toThrow(/CLIENT_HOOK_ENC_KEY/)
    expect(() => loadEncKey({})).toThrow(/B24_TOKEN_ENC_KEY/)
  })
})
