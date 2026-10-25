// Запросы к НАШЕМУ серверу (/api) с фрейм-токеном в заголовках. Сервер проверяет токен
// сам (server/utils/frameAuth.ts) — заголовки здесь лишь сообщают, кто пришёл.

import { tokenNeedsRefresh } from '~/utils/frameToken'

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly data?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

export function useApi() {
  const { getOrThrow } = useB24()

  async function authHeaders(): Promise<Record<string, string>> {
    const frame = getOrThrow()
    const current = frame.auth.getAuthData()
    const auth = tokenNeedsRefresh(current) ? await frame.auth.refreshAuth() : current as Exclude<typeof current, false>
    // `domain` у SDK — с протоколом (getTargetOrigin); сервер вынимает из него хост сам.
    return { 'Authorization': `Bearer ${auth.access_token}`, 'X-B24-Domain': auth.domain }
  }

  /** POST в наш API. Ошибку сервера превращает в {@link ApiError} с его текстом. */
  async function post<T>(url: string, body: unknown): Promise<T> {
    try {
      // Предел (#27): ИИ отвечает до 2 минут (llm.ts), дальше — понятная ошибка, а не вечная крутилка
      const res = await $fetch(url, { method: 'POST', body: body as Record<string, unknown>, headers: await authHeaders(), timeout: 150_000 })
      return res as T
    } catch (e) {
      const err = e as { statusCode?: number, statusMessage?: string, data?: { statusMessage?: string, error?: string } }
      const timedOut = (e as { name?: string, cause?: { name?: string } }).cause?.name === 'TimeoutError' || (e as { name?: string }).name === 'TimeoutError'
      const message = timedOut ? 'Сервер приложения не ответил вовремя — попробуйте ещё раз' : err.data?.statusMessage || err.data?.error || err.statusMessage || 'Сервер приложения не ответил'
      throw new ApiError(err.statusCode ?? 0, message, err.data)
    }
  }

  /**
   * POST с потоковым ответом: куски текста — в `onChunk` по мере прихода. Ошибка до начала
   * потока (лимит, пустой вопрос) — {@link ApiError} с текстом сервера.
   */
  async function postStream(url: string, body: unknown, onChunk: (text: string) => void, signal?: AbortSignal): Promise<void> {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { ...await authHeaders(), 'Content-Type': 'application/json' },
        signal
      })
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      throw new ApiError(0, 'Сервер приложения не ответил')
    }
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => null) as { statusMessage?: string, message?: string } | null
      throw new ApiError(res.status, data?.statusMessage || data?.message || 'Сервер приложения не ответил', data)
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) onChunk(value)
    }
  }

  return { post, postStream }
}
