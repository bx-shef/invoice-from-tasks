// POST /api/public/invoice — публичная страница счёта (#34): `{ domain, invoiceId, code }`
// → расшифровка счёта или спокойная фраза. Без фрейма: клиент — не сотрудник портала. Решение —
// `loadPublicInvoice` (server/utils/publicInvoice.ts, покрыт тестами), зависимости — publicContext.
// Код в журнал не пишем.

import { clientIp } from '../../utils/requestContext'
import { loadPublicInvoice, PUBLIC_404_FLOOR_MS } from '../../utils/publicInvoice'
import { publicDeps } from '../../utils/publicContext'
import { ipBucketKey } from '../../utils/requestLimits'

export default defineEventHandler(async (event) => {
  const started = Date.now()
  setResponseHeaders(event, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' })
  const body = await readBody<{ domain?: unknown, invoiceId?: unknown, code?: unknown } | null>(event)
  const domain = typeof body?.domain === 'string' ? body.domain.trim().toLowerCase().slice(0, 260) : ''
  const result = await loadPublicInvoice({
    domain,
    invoiceId: Number(body?.invoiceId),
    code: typeof body?.code === 'string' ? body.code.trim() : '',
    ip: ipBucketKey(clientIp(event))
  }, publicDeps()).catch((e: unknown) => {
    // Сбой портала (токен, сеть, лимит) — без подробностей наружу: публичная страница. Домен уже
    // проверен на символы имени хоста (DOMAIN_RE) — в журнал он попадает безопасным.
    console.error(`[public] invoice failed domain=${JSON.stringify(domain)}: ${e instanceof Error ? e.message : String(e)}`)
    return { status: 503 as const, body: { error: 'Сервис временно недоступен — попробуйте позже' } }
  })
  if (result.status === 404) {
    // Время ответа «неверный код или счёт» не зависит от того, сколько запросов в портал ушло.
    const wait = PUBLIC_404_FLOOR_MS - (Date.now() - started)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  }
  setResponseStatus(event, result.status)
  return result.body
})
