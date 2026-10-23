import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiGatewayError, askBitrixGpt, enforceAiLimit, enforceKbChatLimit, streamBitrixGpt } from '../../server/utils/aiGateway'
import type { FrameUser } from '../../server/utils/frameAuth'
import { AI_LIMITS, KB_CHAT_LIMITS, SlidingWindow } from '../../server/utils/rateLimit'

function user(userId: number, memberId = 'm1'): FrameUser {
  return {
    userId,
    isAdmin: false,
    portal: { memberId, domain: 'demo.bitrix24.ru', accessTokenEnc: '', refreshTokenEnc: '', expiresAt: 0, applicationToken: 't', installedAt: 0 }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('enforceAiLimit', () => {
  it('сотрудник упирается в свой лимит строк, коллега — нет', () => {
    const window = new SlidingWindow()
    enforceAiLimit(user(1), { window, now: 1000, weight: AI_LIMITS.userRows.max })
    expect(() => enforceAiLimit(user(1), { window, now: 1000, weight: 1 })).toThrow(AiGatewayError)
    expect(() => enforceAiLimit(user(2), { window, now: 1000, weight: 25 })).not.toThrow()
  })

  it('поток запросов по одной строке упирается в лимит ЗАПРОСОВ, а не в тысячи вызовов', () => {
    const window = new SlidingWindow()
    let passed = 0
    for (let i = 0; i < AI_LIMITS.userRequests.max + 50; i++) {
      try {
        enforceAiLimit(user(1), { window, now: i, weight: 1 })
        passed++
      } catch {
        // отказ по лимиту
      }
    }
    expect(passed).toBe(AI_LIMITS.userRequests.max)
  })

  it('пакеты по 25 строк: счёт в 800 строк проходит целиком', () => {
    const window = new SlidingWindow()
    for (let i = 0; i < 32; i++) expect(() => enforceAiLimit(user(1), { window, now: i, weight: 25 })).not.toThrow()
  })

  it('отказ — 429 с текстом для сотрудника; окно истекло — снова можно', () => {
    const window = new SlidingWindow()
    enforceAiLimit(user(1), { window, now: 0, weight: AI_LIMITS.userRows.max })
    try {
      enforceAiLimit(user(1), { window, now: 0 })
      expect.unreachable()
    } catch (e) {
      expect(e).toMatchObject({ statusCode: 429, message: expect.stringMatching(/обращений к ИИ/) })
    }
    expect(() => enforceAiLimit(user(1), { window, now: AI_LIMITS.userRows.windowMs + 1 })).not.toThrow()
  })
})

describe('askBitrixGpt', () => {
  const req = { messages: [{ role: 'user' as const, content: 'описание задачи' }], json: false }

  it('отдаёт ответ модели', async () => {
    expect(await askBitrixGpt(req, async () => 'ответ')).toBe('ответ')
  })

  it('отказ — 502 с понятным текстом; сырой ответ провайдера не уходит ни наружу, ни в журнал', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = '401 invalid api key; echo: описание задачи клиента'
    const err = await askBitrixGpt(req, async () => {
      throw new Error(raw)
    }).catch(e => e)
    expect(err).toBeInstanceOf(AiGatewayError)
    expect(err.statusCode).toBe(502)
    expect(err.message).not.toContain('описание')
    expect(log.mock.calls.flat().join(' ')).toContain('kind=auth')
    expect(log.mock.calls.flat().join(' ')).not.toContain('описание')
  })
})

describe('enforceKbChatLimit', () => {
  it('30 вопросов за 10 минут на сотрудника, коллега — независимо; через 10 минут — снова', () => {
    const window = new SlidingWindow()
    for (let i = 0; i < KB_CHAT_LIMITS.user.max; i++) enforceKbChatLimit(user(1), { window, now: 1000 })
    expect(() => enforceKbChatLimit(user(1), { window, now: 1000 })).toThrow(AiGatewayError)
    expect(() => enforceKbChatLimit(user(2), { window, now: 1000 })).not.toThrow()
    expect(() => enforceKbChatLimit(user(1), { window, now: 1000 + KB_CHAT_LIMITS.user.windowMs + 1 })).not.toThrow()
  })

  it('свой счётчик: исчерпанный лимит чата не мешает названиям строк', () => {
    for (let i = 0; i < KB_CHAT_LIMITS.user.max; i++) enforceKbChatLimit(user(7))
    expect(() => enforceKbChatLimit(user(7))).toThrow(/30 за 10 минут/)
    expect(() => enforceAiLimit(user(7))).not.toThrow()
  })
})

describe('streamBitrixGpt', () => {
  const req = { messages: [{ role: 'user' as const, content: 'q' }], json: false }
  const collect = async (it: AsyncIterable<string>) => {
    const out: string[] = []
    for await (const t of it) out.push(t)
    return out
  }

  it('повторяет временную ошибку до первого куска', async () => {
    let calls = 0
    const stream = async function* () {
      calls++
      if (calls === 1) throw new Error('503 overloaded')
      yield 'а'
      yield 'б'
    }
    expect(await collect(streamBitrixGpt(req, { stream, sleep: async () => {} }))).toEqual(['а', 'б'])
    expect(calls).toBe(2)
  })

  it('после первого куска не повторяет — отказ 502', async () => {
    let calls = 0
    const stream = async function* () {
      calls++
      yield 'а'
      throw new Error('503 overloaded')
    }
    await expect(collect(streamBitrixGpt(req, { stream, sleep: async () => {} }))).rejects.toMatchObject({ statusCode: 502 })
    expect(calls).toBe(1)
  })
})
