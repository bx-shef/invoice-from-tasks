// Чтение задач в портале КЛИЕНТА его входящим вебхуком (#34, этап 4). Вебхук хранится в поле
// «Вебхук клиента» компании или контакта зашифрованным (clientHook.ts); расшифровывается только
// здесь, на сервере, и наружу не уходит. Портал клиента — чужой: ответы недоверенные (разбор —
// parseClientTask), запросы — только https, без редиректов (SSRF), с таймаутом и пределом размера.

import { batchCommand, parseClientTask, type ClientTaskView } from '#shared/domain/publicInvoice'
import { parseWebhookUrl } from '#shared/domain/appFieldTypes'

/** Сколько ждём портал клиента — публичная страница не должна висеть из-за чужого портала. */
export const CLIENT_PORTAL_TIMEOUT_MS = 8000
/** Предел ответа портала клиента, байт. */
export const CLIENT_PORTAL_MAX_BYTES = 2 * 1024 * 1024
/** Сколько задач клиента читаем за раз (пакет `batch` — до 50 команд). */
export const MAX_CLIENT_TASKS = 20

export type HookFetch = (url: string, init: { method: 'POST', body: string, headers: Record<string, string>, redirect: 'error', signal: AbortSignal }) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>

/** Адрес метода по вебхуку: v2 — `https://<портал>/rest/<id>/<код>/<метод>.json`, v3 — `/rest/api/<id>/<код>/<метод>`. */
export function hookMethodUrl(hookUrl: string, method: string, v3 = false): string {
  const hook = parseWebhookUrl(hookUrl)
  if (!hook) throw new Error('client hook: bad url')
  const m = /^\/rest\/(\d+)\/([A-Za-z0-9]+)\/$/.exec(new URL(hook.url).pathname)!
  return v3 ? `https://${hook.host}/rest/api/${m[1]}/${m[2]}/${method}` : `https://${hook.host}/rest/${m[1]}/${m[2]}/${method}.json`
}

/** Вызов метода портала клиента; ошибка портала, сеть, таймаут, размер — исключение (без адреса вебхука). */
export async function callClientPortal(fetchImpl: HookFetch, hookUrl: string, method: string, params: Record<string, unknown>, v3 = false): Promise<unknown> {
  const res = await fetchImpl(hookMethodUrl(hookUrl, method, v3), {
    method: 'POST',
    body: JSON.stringify(params),
    headers: { 'content-type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(CLIENT_PORTAL_TIMEOUT_MS)
  })
  const text = await res.text()
  if (text.length > CLIENT_PORTAL_MAX_BYTES) throw new Error(`client portal ${method}: response too large`)
  let body: { result?: unknown, error?: unknown } | null
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`client portal ${method}: HTTP ${res.status}, not JSON`)
  }
  if (!res.ok || body?.error) throw new Error(`client portal ${method}: ${String(body?.error ?? res.status)}`)
  return body?.result
}

/**
 * Задачи клиента по номерам: одним пакетом `tasks.task.get` (постановщик, статус, дата закрытия —
 * в ответе сами, замер 2026-10-06) и результаты — запросом v3 на задачу. Сбой отдельной задачи —
 * её нет в ответе; сбой портала целиком — пустой ответ: публичная страница показывает свою часть.
 */
export async function readClientTasks(fetchImpl: HookFetch, hookUrl: string, ids: number[]): Promise<Map<number, ClientTaskView>> {
  const out = new Map<number, ClientTaskView>()
  const list = [...new Set(ids)].slice(0, MAX_CLIENT_TASKS)
  if (!list.length) return out
  const select = ['ID', 'TITLE', 'DESCRIPTION', 'STATUS', 'CLOSED_DATE', 'CREATED_BY']
  const cmd = Object.fromEntries(list.map(id => [`t${id}`, batchCommand('tasks.task.get', { taskId: id, select })]))
  const res = await callClientPortal(fetchImpl, hookUrl, 'batch', { halt: 0, cmd }) as { result?: Record<string, unknown> } | null
  const got = res?.result && typeof res.result === 'object' ? res.result : {}
  for (const id of list) {
    const raw = got[`t${id}`]
    if (!raw) continue
    const results = await callClientPortal(fetchImpl, hookUrl, 'tasks.task.result.list', { filter: [['taskId', '=', id]], select: ['id', 'text'], order: { id: 'desc' }, pagination: { limit: 20 } }, true).catch(() => null)
    const view = parseClientTask(raw, results)
    if (view) out.set(id, view)
  }
  return out
}
