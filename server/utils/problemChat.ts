// Сообщения в чат проблем от бота приложения (просьба владельца 2026-10-07; как в
// client-bank-alfa-by: app/utils/b24BotRegister.ts, server/utils/chatBotSend.ts). Бот
// регистрируется лениво при первом сообщении (`imbot.v2.Bot.register`, идемпотентно по `code`),
// пишет `imbot.v2.Chat.Message.send`; нет доступа к чату — вступает (`im.chat.user.add`) и шлёт
// снова; бот недоступен (нет права `imbot`, лимит ботов) — сообщение уходит как раньше,
// `im.message.add` от установщика. Токен — установщика. Чистый модуль: зависимости — параметрами.

import type { RestCall } from './b24Client'

/** Бот приложения. ⚠ `code` не менять: по нему портал узнаёт уже зарегистрированного бота. */
export const PROBLEM_BOT = { code: 'ift_problems_bot', name: 'Счёт из задач', position: 'Приложение Битрикс24' } as const

export const BOT_REGISTER_METHOD = 'imbot.v2.Bot.register'
export const BOT_SEND_METHOD = 'imbot.v2.Chat.Message.send'

/** Отказы, после которых бота на портале не будет (до перезапуска): не регистрируем на каждом сообщении. */
const PERMANENT = ['access_denied', 'access denied', 'bot_limit_exceeded', 'error_method_not_found', 'invalid_credentials', 'insufficient_scope', 'higher privileges']

export function isPermanentBotError(e: unknown): boolean {
  const text = String(e instanceof Error ? e.message : e).toLowerCase()
  return PERMANENT.some(code => text.includes(code))
}

function positiveId(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** ID бота из ответа регистрации: замер client-bank — `users[0].id`; документация — `bot.id`. */
export function extractBotId(result: unknown): number | null {
  if (result === null || typeof result !== 'object') return positiveId(result)
  const box = result as Record<string, unknown>
  const first = Array.isArray(box.users) ? box.users[0] as Record<string, unknown> | undefined : undefined
  return positiveId(first?.id) ?? positiveId((box.bot as Record<string, unknown> | undefined)?.id) ?? positiveId(box.id ?? box.ID)
}

export function registerParams(): Record<string, unknown> {
  return { fields: { code: PROBLEM_BOT.code, type: 'bot', eventMode: 'fetch', properties: { name: PROBLEM_BOT.name, workPosition: PROBLEM_BOT.position } } }
}

/** Сообщение бота: содержимое — во вложенном `fields` со строчными именами (форма v2). */
export function sendParams(botId: number, dialogId: string, text: string): Record<string, unknown> {
  return { botId, dialogId, fields: { message: text, urlPreview: false } }
}

/** Вступить ботом в чат `chat<ID>` без истории. */
export function joinParams(dialogId: string, botId: number): Record<string, unknown> | null {
  const chatId = positiveId(/^chat(\d+)$/.exec(dialogId)?.[1])
  return chatId ? { CHAT_ID: chatId, USERS: [botId], HIDE_HISTORY: 'Y' } : null
}

/**
 * ID бота портала (ключ — домен): из памяти или регистрацией. `null` в памяти — портал бота не
 * даст (постоянный отказ); временный сбой не запоминаем.
 */
export async function resolveBotId(portal: string, call: RestCall, cache: Map<string, number | null>): Promise<number | null> {
  if (cache.has(portal)) return cache.get(portal)!
  try {
    const id = extractBotId(await call(BOT_REGISTER_METHOD, registerParams()))
    if (id) cache.set(portal, id)
    else console.warn('[problem-chat] bot register: no id in answer')
    return id
  } catch (e) {
    if (isPermanentBotError(e)) cache.set(portal, null)
    console.warn(`[problem-chat] bot register: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/**
 * Отправка: ботом (при отказе доступа — вступить и повторить), иначе `im.message.add`.
 * Возвращает, кто написал: `bot` или `user`. Бросает, только если не вышло и запасным путём.
 */
export async function postProblem(portal: string, call: RestCall, dialogId: string, text: string, cache: Map<string, number | null>): Promise<'bot' | 'user'> {
  const botId = await resolveBotId(portal, call, cache)
  if (botId) {
    try {
      await call(BOT_SEND_METHOD, sendParams(botId, dialogId, text))
      return 'bot'
    } catch (e) {
      const join = /access/i.test(String(e instanceof Error ? e.message : e)) ? joinParams(dialogId, botId) : null
      if (join) {
        try {
          await call('im.chat.user.add', join)
          await call(BOT_SEND_METHOD, sendParams(botId, dialogId, text))
          return 'bot'
        } catch (again) {
          console.warn(`[problem-chat] bot join/send: ${again instanceof Error ? again.message : String(again)}`)
        }
      } else {
        console.warn(`[problem-chat] bot send: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  await call('im.message.add', { DIALOG_ID: dialogId, MESSAGE: text, URL_PREVIEW: 'N' })
  return 'user'
}
