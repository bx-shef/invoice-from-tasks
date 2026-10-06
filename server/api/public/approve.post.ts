// POST /api/public/approve — кнопка «Согласовать» на странице счёта в стадии согласования:
// `{ domain, invoiceId, code }`. Решение — `postPublicApprove` (server/utils/publicInvoice.ts).
// Код в журнал не пишем.

import { clientIp } from '../../utils/requestContext'
import { postPublicApprove, PUBLIC_404_FLOOR_MS } from '../../utils/publicInvoice'
import { commentDeps } from '../../utils/publicContext'
import { ipBucketKey } from '../../utils/requestLimits'

export default defineEventHandler(async (event) => {
  const started = Date.now()
  setResponseHeaders(event, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' })
  const body = await readBody<{ domain?: unknown, invoiceId?: unknown, code?: unknown } | null>(event)
  const domain = typeof body?.domain === 'string' ? body.domain.trim().toLowerCase().slice(0, 260) : ''
  const result = await postPublicApprove({
    domain,
    invoiceId: Number(body?.invoiceId),
    code: typeof body?.code === 'string' ? body.code.trim() : '',
    ip: ipBucketKey(clientIp(event))
  }, commentDeps()).catch((e: unknown) => {
    console.error(`[public] approve failed domain=${JSON.stringify(domain)}: ${e instanceof Error ? e.message : String(e)}`)
    return { status: 503 as const, body: { error: 'Сервис временно недоступен — попробуйте позже' } }
  })
  if (result.status === 404) {
    const wait = PUBLIC_404_FLOOR_MS - (Date.now() - started)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  }
  setResponseStatus(event, result.status)
  return result.body
})
