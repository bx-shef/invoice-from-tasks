import { describe, expect, it } from 'vitest'
import { API_BODY_LIMIT, bodyLimitFor, checkBodySize, EVENTS_BODY_LIMIT, pickClientIp } from '../../server/utils/requestLimits'

describe('bodyLimitFor', () => {
  it('события портала — 64 КБ, прочие POST к /api — 512 КБ', () => {
    expect(bodyLimitFor('POST', '/api/b24/events')).toBe(EVENTS_BODY_LIMIT)
    expect(bodyLimitFor('post', '/api/rates')).toBe(API_BODY_LIMIT)
  })

  it('страницы и GET не ограничиваем (портал POST-ит на страницы приложения)', () => {
    expect(bodyLimitFor('GET', '/api/rates')).toBeNull()
    expect(bodyLimitFor('POST', '/invoice')).toBeNull()
    expect(bodyLimitFor('POST', '/apiary')).toBeNull()
  })
})

describe('checkBodySize', () => {
  it('без длины или с мусором — 411', () => {
    for (const v of [undefined, null, '', ' ', 'abc', '-1', '1.5']) {
      expect(checkBodySize(v, 100)).toEqual({ ok: false, status: 411 })
    }
  })

  it('ровно предел — можно, на байт больше — 413', () => {
    expect(checkBodySize('100', 100)).toEqual({ ok: true })
    expect(checkBodySize('101', 100)).toEqual({ ok: false, status: 413 })
    expect(checkBodySize('0', 100)).toEqual({ ok: true })
  })
})

describe('pickClientIp', () => {
  it('без доверенного прокси заголовок игнорируется — только адрес сокета', () => {
    expect(pickClientIp('1.1.1.1', '10.0.0.5', false)).toBe('10.0.0.5')
  })

  it('за прокси — ПОСЛЕДНИЙ адрес: первый прислал клиент и может подделать', () => {
    expect(pickClientIp('6.6.6.6, 203.0.113.7', '10.0.0.5', true)).toBe('203.0.113.7')
    expect(pickClientIp(' 203.0.113.7 ', '10.0.0.5', true)).toBe('203.0.113.7')
  })

  it('пустой заголовок или нет ничего — сокет или unknown', () => {
    expect(pickClientIp(', ,', '10.0.0.5', true)).toBe('10.0.0.5')
    expect(pickClientIp(undefined, undefined, true)).toBe('unknown')
  })
})
