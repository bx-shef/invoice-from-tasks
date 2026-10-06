// Чтение задач в портале КЛИЕНТА его входящим вебхуком (#34, этап 4). Вебхук хранится в поле
// «Вебхук клиента» компании или контакта зашифрованным (clientHook.ts); расшифровывается только
// здесь, на сервере, и наружу не уходит. Портал клиента — чужой: ответы недоверенные (разбор —
// parseClientTask), запросы — только https, без редиректов (SSRF), общий дедлайн, предел размера
// ответа — потоком, до чтения в память.

import { batchCommand, parseClientTask, type ClientTaskView } from '#shared/domain/publicInvoice'
import { parseWebhookUrl } from '#shared/domain/appFieldTypes'

/** Общий дедлайн чтения портала клиента на один просмотр: страница не висит из-за чужого портала. */
export const CLIENT_PORTAL_DEADLINE_MS = 10_000
/** Предел ответа портала клиента, байт. */
export const CLIENT_PORTAL_MAX_BYTES = 2 * 1024 * 1024
/** Сколько задач клиента читаем за раз (пакет `batch` — до 50 команд). */
export const MAX_CLIENT_TASKS = 20
/** Сколько запросов результатов идут одновременно. */
const RESULTS_CONCURRENCY = 4

export interface HookResponse {
  ok: boolean
  status: number
  headers: { get: (name: string) => string | null }
  body: ReadableStream<Uint8Array> | null
}
export type HookFetch = (url: string, init: { method: 'POST', body: string, headers: Record<string, string>, redirect: 'error', signal: AbortSignal }) => Promise<HookResponse>

/** Адрес метода по вебхуку: v2 — `https://<портал>/rest/<id>/<код>/<метод>.json`, v3 — `/rest/api/<id>/<код>/<метод>`. */
export function hookMethodUrl(hookUrl: string, method: string, v3 = false): string {
  const hook = parseWebhookUrl(hookUrl)
  if (!hook) throw new Error('client hook: bad url')
  return v3
    ? `https://${hook.host}/rest/api/${hook.userId}/${hook.code}/${method}`
    : `https://${hook.host}/rest/${hook.userId}/${hook.code}/${method}.json`
}

/** Тело ответа потоком с пределом в байтах: огромный ответ обрывается, а не ложится в память. */
export async function readLimited(res: HookResponse, max = CLIENT_PORTAL_MAX_BYTES): Promise<string> {
  return new TextDecoder().decode(await readLimitedBytes(res, max))
}

/** То же байтами — для PDF документов (этап 5). */
export async function readLimitedBytes(res: HookResponse, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) throw new Error('response too large')
  if (!res.body) return new Uint8Array()
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw new Error('response too large')
    }
    parts.push(value)
  }
  return new Uint8Array(Buffer.concat(parts))
}

/** Текст ошибки портала: строка или `{ code, message }` (v3) — без адреса вебхука. */
function errorText(error: unknown, status: number): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    return String(e.code ?? e.message ?? JSON.stringify(e)).slice(0, 200)
  }
  return `HTTP ${status}`
}

/** Вызов метода портала клиента; ошибка портала, сеть, дедлайн, размер — исключение (без адреса вебхука). */
export async function callClientPortal(fetchImpl: HookFetch, hookUrl: string, method: string, params: Record<string, unknown>, signal: AbortSignal, v3 = false): Promise<unknown> {
  let res: HookResponse
  try {
    res = await fetchImpl(hookMethodUrl(hookUrl, method, v3), {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
      signal
    })
  } catch (e) {
    // Исключение fetch несёт адрес вебхука (с секретным кодом) в `cause` — наружу только имя ошибки.
    // eslint-disable-next-line preserve-caught-error -- cause нельзя: в нём адрес вебхука
    throw new Error(`client portal ${method}: ${e instanceof Error ? e.name : 'fetch failed'}`)
  }
  let text: string
  try {
    text = await readLimited(res)
  } catch (e) {
    // eslint-disable-next-line preserve-caught-error -- ошибка чтения своя, без адреса; cause не нужен
    throw new Error(`client portal ${method}: ${e instanceof Error ? e.message : 'read failed'}`)
  }
  let body: { result?: unknown, error?: unknown } | null
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`client portal ${method}: HTTP ${res.status}, not JSON`)
  }
  if (!res.ok || body?.error) throw new Error(`client portal ${method}: ${errorText(body?.error, res.status)}`)
  return body?.result
}

/**
 * Задачи клиента по номерам: одним пакетом `tasks.task.get` (постановщик, статус, дата закрытия —
 * в ответе сами, замер 2026-10-06) и результаты — запросом v3 на задачу, по 4 одновременно, всё —
 * под общим дедлайном. Пропавшая задача — её нет в ответе; сбой пакета — исключение (журнал — у
 * вызывающего), сбой результатов задачи — задача без результатов.
 */
export async function readClientTasks(fetchImpl: HookFetch, hookUrl: string, ids: number[], deadlineMs = CLIENT_PORTAL_DEADLINE_MS): Promise<Map<number, ClientTaskView>> {
  const out = new Map<number, ClientTaskView>()
  const list = [...new Set(ids)].slice(0, MAX_CLIENT_TASKS)
  if (!list.length) return out
  const host = parseWebhookUrl(hookUrl)?.host ?? ''
  const signal = AbortSignal.timeout(deadlineMs)
  const select = ['ID', 'TITLE', 'DESCRIPTION', 'STATUS', 'CLOSED_DATE', 'CREATED_BY']
  const cmd = Object.fromEntries(list.map(id => [`t${id}`, batchCommand('tasks.task.get', { taskId: id, select })]))
  const res = await callClientPortal(fetchImpl, hookUrl, 'batch', { halt: 0, cmd }, signal) as { result?: Record<string, unknown> } | null
  const got = res?.result && typeof res.result === 'object' ? res.result : {}
  const present = list.filter(id => got[`t${id}`])
  for (let i = 0; i < present.length; i += RESULTS_CONCURRENCY) {
    await Promise.all(present.slice(i, i + RESULTS_CONCURRENCY).map(async (id) => {
      const results = await callClientPortal(fetchImpl, hookUrl, 'tasks.task.result.list', { filter: [['taskId', '=', id]], select: ['id', 'text'], order: { id: 'desc' }, pagination: { limit: 20 } }, signal, true).catch(() => null)
      const view = parseClientTask(got[`t${id}`], results, host)
      if (view) out.set(id, view)
    }))
  }
  return out
}
