// POST /api/public/invoice — публичная страница счёта (#34, этап 3): `{ domain, invoiceId, code }`
// → расшифровка счёта или спокойная фраза. Без фрейма: клиент — не сотрудник портала. Решение —
// `loadPublicInvoice` (server/utils/publicInvoice.ts, покрыт тестами). Код в журнал не пишем.

import { getPortalByDomain } from '../../utils/tokenStore'
import { clientIp, installerCallFor, portalStore } from '../../utils/requestContext'
import { isAllowedPortalHost, parseSelfHostedHosts } from '../../utils/b24Host'
import { loadPublicInvoice, PUBLIC_404_FLOOR_MS, PUBLIC_CACHE_MS, PUBLIC_FAILS_PER_INVOICE, PUBLIC_PER_IP, PUBLIC_PER_PORTAL } from '../../utils/publicInvoice'
import { SlidingWindow } from '../../utils/rateLimit'
import { ipBucketKey } from '../../utils/requestLimits'
import type { PublicInvoiceView } from '#shared/domain/publicInvoice'

const attempts = new SlidingWindow()
const failures = new SlidingWindow()
const cache = new Map<string, { at: number, view: PublicInvoiceView }>()
const MAX_CACHE = 500

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
  }, {
    allowAttempt: (ipKey, portalKey) => attempts.take([[ipKey, PUBLIC_PER_IP], [portalKey, PUBLIC_PER_PORTAL]]),
    // Проверка без учёта (вес 0), учёт — только неверного кода: верный код счётчик не тратит.
    locked: key => failures.used(key, PUBLIC_FAILS_PER_INVOICE) >= PUBLIC_FAILS_PER_INVOICE.max,
    fail: (key) => { failures.take([[key, PUBLIC_FAILS_PER_INVOICE]]) },
    cache: {
      get: (key) => {
        const hit = cache.get(key)
        return hit && Date.now() - hit.at < PUBLIC_CACHE_MS ? hit.view : undefined
      },
      set: (key, view) => {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!)
        cache.set(key, { at: Date.now(), view })
      }
    },
    portal: async (d) => {
      // SSRF-гард: в портал идём только по разрешённым доменам, и только если он нас установил.
      if (!isAllowedPortalHost(d, parseSelfHostedHosts(process.env.B24_SELFHOSTED_HOSTS))) return null
      const record = await getPortalByDomain(portalStore(), d)
      return record ? { call: installerCallFor(record.memberId), origin: `https://${record.domain}` } : null
    }
  }).catch((e: unknown) => {
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
