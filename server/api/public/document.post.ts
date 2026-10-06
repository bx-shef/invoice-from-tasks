// POST /api/public/document — PDF документа счёта для публичной страницы (#34, этап 5):
// `{ domain, invoiceId, code, documentId }` → файл. Код — в теле, а не в адресе (не осядет в
// журналах прокси и истории браузера). Решение — `loadPublicDocument` (publicInvoice.ts).

import { clientIp } from '../../utils/requestContext'
import { loadPublicDocument, PUBLIC_404_FLOOR_MS } from '../../utils/publicInvoice'
import { publicDeps } from '../../utils/publicContext'
import { ipBucketKey } from '../../utils/requestLimits'

export default defineEventHandler(async (event) => {
  const started = Date.now()
  setResponseHeaders(event, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' })
  const body = await readBody<{ domain?: unknown, invoiceId?: unknown, code?: unknown, documentId?: unknown } | null>(event)
  const domain = typeof body?.domain === 'string' ? body.domain.trim().toLowerCase().slice(0, 260) : ''
  const result = await loadPublicDocument({
    domain,
    invoiceId: Number(body?.invoiceId),
    documentId: Number(body?.documentId),
    code: typeof body?.code === 'string' ? body.code.trim() : '',
    ip: ipBucketKey(clientIp(event))
  }, publicDeps()).catch((e: unknown) => {
    console.error(`[public] document failed domain=${JSON.stringify(domain)}: ${e instanceof Error ? e.message : String(e)}`)
    return { status: 503 as const, body: { error: 'Документ временно недоступен — попробуйте позже' } }
  })
  if (result.status === 404) {
    const wait = PUBLIC_404_FLOOR_MS - (Date.now() - started)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  }
  setResponseStatus(event, result.status)
  if ('pdf' in result) {
    setResponseHeaders(event, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
    })
    return Buffer.from(result.pdf)
  }
  return result.body
})
