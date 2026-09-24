import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiGatewayError, askBitrixGpt, enforceAiLimit } from '../../server/utils/aiGateway'
import type { FrameUser } from '../../server/utils/frameAuth'
import { AI_LIMITS, SlidingWindow } from '../../server/utils/rateLimit'

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
  it('сотрудник упирается в свой лимит, коллега — нет', () => {
    const w = new SlidingWindow()
    for (let i = 0; i < AI_LIMITS.user.max; i++) enforceAiLimit(user(1), w, 1000)
    expect(() => enforceAiLimit(user(1), w, 1000)).toThrow(AiGatewayError)
    expect(() => enforceAiLimit(user(2), w, 1000)).not.toThrow()
  })

  it('отказ — 429 с текстом для сотрудника; окно истекло — снова можно', () => {
    const w = new SlidingWindow()
    for (let i = 0; i < AI_LIMITS.user.max; i++) enforceAiLimit(user(1), w, 0)
    try {
      enforceAiLimit(user(1), w, 0)
      expect.unreachable()
    } catch (e) {
      expect(e).toMatchObject({ statusCode: 429, message: expect.stringMatching(/BitrixGPT/) })
    }
    expect(() => enforceAiLimit(user(1), w, AI_LIMITS.user.windowMs + 1)).not.toThrow()
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
