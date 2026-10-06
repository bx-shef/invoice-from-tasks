// POST /api/public/invoice — публичная страница счёта (#34, этап 3): `{ domain, invoiceId, code }`
// → расшифровка счёта или спокойная фраза. Без фрейма: клиент — не сотрудник портала. Решение —
// `loadPublicInvoice` (server/utils/publicInvoice.ts, покрыт тестами). Код в журнал не пишем.

import { getPortalByDomain } from '../../utils/tokenStore'
import { clientIp, installerCallFor, portalStore } from '../../utils/requestContext'
import { isAllowedPortalHost, parseSelfHostedHosts } from '../../utils/b24Host'
import { loadPublicInvoice, PUBLIC_PER_INVOICE, PUBLIC_PER_IP } from '../../utils/publicInvoice'
import { SlidingWindow } from '../../utils/rateLimit'
import { ipBucketKey } from '../../utils/requestLimits'

const windows = new SlidingWindow()

export default defineEventHandler(async (event) => {
  const body = await readBody<{ domain?: unknown, invoiceId?: unknown, code?: unknown } | null>(event)
  const domain = typeof body?.domain === 'string' ? body.domain.trim().toLowerCase() : ''
  const result = await loadPublicInvoice({
    domain,
    invoiceId: Number(body?.invoiceId),
    code: typeof body?.code === 'string' ? body.code.trim() : '',
    ip: ipBucketKey(clientIp(event))
  }, {
    allow: (ipKey, invoiceKey) => windows.take([[ipKey, PUBLIC_PER_IP], [invoiceKey, PUBLIC_PER_INVOICE]]),
    portal: async (d) => {
      // SSRF-гард: в портал идём только по разрешённым доменам, и только если он нас установил.
      if (!isAllowedPortalHost(d, parseSelfHostedHosts(process.env.B24_SELFHOSTED_HOSTS))) return null
      const record = await getPortalByDomain(portalStore(), d)
      return record ? { call: installerCallFor(record.memberId), origin: `https://${record.domain}` } : null
    }
  }).catch((e: unknown) => {
    // Сбой портала (токен, сеть) — без подробностей наружу: публичная страница.
    console.error(`[public] invoice failed domain=${domain}: ${e instanceof Error ? e.message : String(e)}`)
    return { status: 503 as const, body: { error: 'Сервис временно недоступен — попробуйте позже' } }
  })
  setResponseStatus(event, result.status)
  return result.body
})
