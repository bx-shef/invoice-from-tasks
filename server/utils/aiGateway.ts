// Общая часть AI-эндпоинтов: лимит частоты и вызов BitrixGPT с повторами.
// Без автоимпортов Nitro (конвенция CLAUDE.md): ошибки — свой класс, в HTTP-ответ их переводит
// `requestContext.ts → aiHttpError`. Так модуль тестируется в node без Nitro.

import { backoffMs, chatWithRetry, describeLlmFailure, isTransient, makeChatFn, makeChatStreamFn, resolveLlmConfig, type ChatFn, type ChatRequest, type ChatStreamFn } from './llm'
import { AI_LIMITS, KB_CHAT_LIMITS, SlidingWindow } from './rateLimit'
import type { FrameUser } from './frameAuth'

export interface AiLimitOptions {
  /** Сколько строк несёт обращение: число строк в запросе названий, `CONSULT_WEIGHT` для консультации. */
  weight?: number
  window?: SlidingWindow
  now?: number
}

/** Отказ AI-шлюза с HTTP-кодом и текстом для сотрудника (без сырого текста провайдера). */
export class AiGatewayError extends Error {
  constructor(readonly statusCode: 429 | 502, message: string) {
    super(message)
    this.name = 'AiGatewayError'
  }
}

const windows = new SlidingWindow()

/** Бросает {@link AiGatewayError} 429, если сотрудник или портал исчерпали лимит обращений. */
export function enforceAiLimit(user: FrameUser, opts: AiLimitOptions = {}): void {
  // Два измерения сразу (rateLimit.ts): число вызовов модели и число строк в них.
  const rows = opts.weight ?? 1
  const who = `${user.portal.memberId}:${user.userId}`
  const ok = (opts.window ?? windows).take([
    [`ur:${who}`, AI_LIMITS.userRequests, 1],
    [`uw:${who}`, AI_LIMITS.userRows, rows],
    [`pr:${user.portal.memberId}`, AI_LIMITS.portalRequests, 1],
    [`pw:${user.portal.memberId}`, AI_LIMITS.portalRows, rows]
  ], opts.now ?? Date.now())
  if (!ok) throw new AiGatewayError(429, 'Слишком много обращений к ИИ. Попробуйте позже.')
}

const kbWindows = new SlidingWindow()

/** Лимит ИИ-чата справки (KB_CHAT_LIMITS) — свой счётчик, общие AI_LIMITS не трогает. */
export function enforceKbChatLimit(user: FrameUser, opts: Pick<AiLimitOptions, 'window' | 'now'> = {}): void {
  const ok = (opts.window ?? kbWindows).take([
    [`kb-u:${user.portal.memberId}:${user.userId}`, KB_CHAT_LIMITS.user, 1],
    [`kb-p:${user.portal.memberId}`, KB_CHAT_LIMITS.portal, 1]
  ], opts.now ?? Date.now())
  if (!ok) throw new AiGatewayError(429, 'Слишком много вопросов в справку: не больше 30 за 10 минут. Попробуйте чуть позже.')
}

let liveChat: ChatFn | null = null

/**
 * Вызов BitrixGPT. Ошибка превращается в {@link AiGatewayError} 502 с понятным текстом; в журнал —
 * только класс отказа (сырой ответ провайдера может цитировать описания задач).
 */
export async function askBitrixGpt(req: ChatRequest, chat?: ChatFn): Promise<string> {
  const fn = chat ?? (liveChat ??= makeChatFn(resolveLlmConfig(process.env)))
  try {
    return await chatWithRetry(fn, req)
  } catch (e) {
    const failure = describeLlmFailure(e instanceof Error ? e.message : String(e))
    console.error(`[bitrixgpt] failure kind=${failure.kind} code=${failure.code || '-'}`)
    throw new AiGatewayError(502, failure.message)
  }
}

let liveStream: ChatStreamFn | null = null

/**
 * Поток BitrixGPT по кускам (ИИ-чат справки). Временная ошибка ДО первого куска — повтор, как в
 * `chatWithRetry`; после первого куска не повторяем — текст уже у сотрудника. Отказ —
 * {@link AiGatewayError} 502 с понятным текстом.
 */
export async function* streamBitrixGpt(
  req: ChatRequest,
  deps: { stream?: ChatStreamFn, sleep?: (ms: number) => Promise<void>, maxAttempts?: number } = {}
): AsyncGenerator<string> {
  const fn = deps.stream ?? (liveStream ??= makeChatStreamFn(resolveLlmConfig(process.env)))
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const maxAttempts = deps.maxAttempts ?? 3
  for (let attempt = 1; ; attempt++) {
    let started = false
    try {
      for await (const text of fn(req)) {
        started = true
        yield text
      }
      return
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!started && isTransient(message) && attempt < maxAttempts) {
        await sleep(backoffMs(attempt, Math.random()))
        continue
      }
      const failure = describeLlmFailure(message)
      console.error(`[bitrixgpt] stream failure kind=${failure.kind} code=${failure.code || '-'}`)
      throw new AiGatewayError(502, failure.message)
    }
  }
}
