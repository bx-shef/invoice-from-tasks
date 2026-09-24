// Общая часть AI-эндпоинтов: лимит частоты и вызов BitrixGPT с повторами.

import { chatWithRetry, describeLlmFailure, makeChatFn, resolveLlmConfig, type ChatRequest } from './llm'
import { AI_LIMITS, SlidingWindow } from './rateLimit'
import type { FrameUser } from './frameAuth'

const windows = new SlidingWindow()

/** Бросает 429, если сотрудник или портал исчерпали лимит обращений к BitrixGPT. */
export function enforceAiLimit(user: FrameUser): void {
  const ok = windows.take([
    [`u:${user.portal.memberId}:${user.userId}`, AI_LIMITS.user],
    [`p:${user.portal.memberId}`, AI_LIMITS.portal]
  ])
  if (!ok) throw createError({ statusCode: 429, statusMessage: 'Слишком много обращений к BitrixGPT. Попробуйте позже.' })
}

let chat: ReturnType<typeof makeChatFn> | null = null

/** Вызов BitrixGPT. Ошибка превращается в 502 с понятным текстом; сырой ответ провайдера — только класс в журнал. */
export async function askBitrixGpt(req: ChatRequest): Promise<string> {
  chat ??= makeChatFn(resolveLlmConfig(process.env))
  try {
    return await chatWithRetry(chat, req)
  } catch (e) {
    const failure = describeLlmFailure(e instanceof Error ? e.message : String(e))
    console.error(`[bitrixgpt] failure kind=${failure.kind}`)
    throw createError({ statusCode: 502, statusMessage: failure.message })
  }
}
