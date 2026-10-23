// POST /api/public/decide — решения клиента по задачам в стадии согласования:
// `{ domain, invoiceId, code, decisions: { "<taskId>": "yes" | "no" } }`. Решение — `postPublicDecide`
// (server/utils/publicInvoice.ts).
// Код в журнал не пишем.

import { clientIp } from '../../utils/requestContext'
import { postPublicDecide, PUBLIC_404_FLOOR_MS } from '../../utils/publicInvoice'
import { commentDeps } from '../../utils/publicContext'
import { ipBucketKey } from '../../utils/requestLimits'

export default defineEventHandler(async (event) => {
  const started = Date.now()
  setResponseHeaders(event, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' })
  const body = await readBody<{ domain?: unknown, invoiceId?: unknown, code?: unknown, decisions?: unknown } | null>(event)
  const domain = typeof body?.domain === 'string' ? body.domain.trim().toLowerCase().slice(0, 260) : ''
  const result = await postPublicDecide({
    domain,
    invoiceId: Number(body?.invoiceId),
    code: typeof body?.code === 'string' ? body.code.trim() : '',
    ip: ipBucketKey(clientIp(event)),
    decisions: body?.decisions
  }, commentDeps()).catch((e: unknown) => {
    console.error(`[public] decide failed domain=${JSON.stringify(domain)}: ${e instanceof Error ? e.message : String(e)}`)
    return { status: 503 as const, body: { error: 'Сервис временно недоступен — попробуйте позже' } }
  })
  if (result.status === 404) {
    const wait = PUBLIC_404_FLOOR_MS - (Date.now() - started)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  }
  setResponseStatus(event, result.status)
  return result.body
})
