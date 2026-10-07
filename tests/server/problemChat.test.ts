import { describe, expect, it, vi } from 'vitest'
import { extractBotId, isPermanentBotError, joinParams, postProblem, PROBLEM_BOT, sendParams } from '../../server/utils/problemChat'

type Handler = (method: string, params: Record<string, unknown>) => unknown

function portal(handler: Handler) {
  const calls: string[] = []
  const call = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    calls.push(method)
    return handler(method, params)
  })
  return { call, calls }
}

describe('бот чата проблем', () => {
  it('ID бота: users[0].id (замер client-bank), bot.id (документация), число', () => {
    expect(extractBotId({ users: [{ id: '17' }] })).toBe(17)
    expect(extractBotId({ bot: { id: 5 } })).toBe(5)
    expect(extractBotId(9)).toBe(9)
    expect(extractBotId({})).toBeNull()
  })

  it('сообщение v2: содержимое во вложенном fields, без превью ссылок; вступление — только chat<ID>', () => {
    expect(sendParams(17, 'chat5', 'x')).toEqual({ botId: 17, dialogId: 'chat5', fields: { message: 'x', urlPreview: false } })
    expect(joinParams('chat5', 17)).toEqual({ CHAT_ID: 5, USERS: [17], HIDE_HISTORY: 'Y' })
    expect(joinParams('15', 17)).toBeNull()
  })

  it('пишет ботом; бот регистрируется один раз на портал', async () => {
    const cache = new Map<string, number | null>()
    const p = portal(m => (m === 'imbot.v2.Bot.register' ? { users: [{ id: 17 }] } : { id: 1 }))
    expect(await postProblem('a.bitrix24.by', p.call, 'chat5', 'текст', cache)).toBe('bot')
    expect(await postProblem('a.bitrix24.by', p.call, 'chat5', 'текст', cache)).toBe('bot')
    expect(p.calls.filter(m => m === 'imbot.v2.Bot.register')).toHaveLength(1)
    expect(p.call).toHaveBeenCalledWith('imbot.v2.Bot.register', { fields: expect.objectContaining({ code: PROBLEM_BOT.code, type: 'bot' }) })
  })

  it('бота нет в чате — вступает и шлёт снова', async () => {
    let sent = 0
    const p = portal((m) => {
      if (m === 'imbot.v2.Bot.register') return { users: [{ id: 17 }] }
      if (m === 'imbot.v2.Chat.Message.send' && sent++ === 0) throw new Error('ACCESS_DENIED: not a member')
      return { id: 1 }
    })
    expect(await postProblem('a', p.call, 'chat5', 'x', new Map())).toBe('bot')
    expect(p.calls).toEqual(['imbot.v2.Bot.register', 'imbot.v2.Chat.Message.send', 'im.chat.user.add', 'imbot.v2.Chat.Message.send'])
  })

  it('нет права imbot — отказ запоминается, пишет установщик через im.message.add', async () => {
    const cache = new Map<string, number | null>()
    const p = portal((m) => {
      if (m === 'imbot.v2.Bot.register') throw new Error('insufficient_scope')
      return true
    })
    expect(await postProblem('a', p.call, 'chat5', 'x', cache)).toBe('user')
    expect(await postProblem('a', p.call, 'chat5', 'x', cache)).toBe('user')
    expect(p.calls.filter(m => m === 'imbot.v2.Bot.register')).toHaveLength(1)
    expect(p.call).toHaveBeenLastCalledWith('im.message.add', { DIALOG_ID: 'chat5', MESSAGE: 'x', URL_PREVIEW: 'N' })
  })

  it('временный сбой регистрации не запоминается: в следующий раз пробуем снова', async () => {
    const cache = new Map<string, number | null>()
    const p = portal((m) => {
      if (m === 'imbot.v2.Bot.register') throw new Error('ETIMEDOUT')
      return true
    })
    await postProblem('a', p.call, 'chat5', 'x', cache)
    expect(cache.has('a')).toBe(false)
    expect(isPermanentBotError(new Error('BOT_LIMIT_EXCEEDED'))).toBe(true)
    expect(isPermanentBotError(new Error('ETIMEDOUT'))).toBe(false)
  })
})
