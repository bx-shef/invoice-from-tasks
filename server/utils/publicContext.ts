// Зависимости публичных обработчиков (#34): страница счёта и скачивание PDF делят ОДНИ счётчики
// попыток, кеш и доступ к порталу — иначе перебор кода шёл бы через второй адрес в обход лимитов.

import type { PublicInvoiceView } from '#shared/domain/publicInvoice'
import { getPortalByDomain } from './tokenStore'
import { installerCallFor, portalStore } from './requestContext'
import { isAllowedPortalHost, parseSelfHostedHosts } from './b24Host'
import { openClientHook } from './clientHook'
import { readClientTasks, readLimitedBytes, type HookFetch } from './clientPortal'
import { MAX_PDF_BYTES, PUBLIC_CACHE_MS, PUBLIC_FAILS_PER_INVOICE, PUBLIC_PER_IP, PUBLIC_PER_PORTAL, type DocumentDeps } from './publicInvoice'
import { SlidingWindow } from './rateLimit'

const attempts = new SlidingWindow()
const failures = new SlidingWindow()
const cache = new Map<string, { at: number, view: PublicInvoiceView }>()
const MAX_CACHE = 500
/** Сколько ждём PDF от портала. */
const PDF_TIMEOUT_MS = 20_000

/** Скачиваний PDF с IP — 60 за 10 минут: их делает клиент с верным кодом, не перебор (тот считают неверные коды). */
export const PUBLIC_DOWNLOADS_PER_IP = { max: 60, windowMs: 10 * 60_000 }

/**
 * @param kind `page` — открытие страницы (лимит перебора по IP), `download` — скачивание PDF
 *   (своё, щедрее окно по IP: клиент с верным кодом скачивает несколько документов). Неверные
 *   коды и портал — общие счётчики у обоих.
 */
export function publicDeps(kind: 'page' | 'download' = 'page'): DocumentDeps {
  const ipLimit = kind === 'download' ? PUBLIC_DOWNLOADS_PER_IP : PUBLIC_PER_IP
  return {
    allowAttempt: (ipKey, portalKey) => attempts.take([[`${kind}:${ipKey}`, ipLimit], [portalKey, PUBLIC_PER_PORTAL]]),
    // Проверка без учёта, учёт — только неверного кода: верный код счётчик не тратит.
    locked: key => failures.used(key, PUBLIC_FAILS_PER_INVOICE) >= PUBLIC_FAILS_PER_INVOICE.max,
    fail: (key) => {
      failures.take([[key, PUBLIC_FAILS_PER_INVOICE]])
    },
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
    // Вебхук расшифровывается только здесь: привязан к нашему порталу (AAD) и снова проверен SSRF-гардом.
    clientTasks: async (hookValue, portalDomain, ids) => {
      let hook: { url: string, host: string }
      try {
        hook = openClientHook(hookValue, portalDomain)
      } catch (e) {
        // Ключ сменили, значение из другого портала, домен вне списка — без самого вебхука в журнале.
        console.warn(`[public] client hook not opened: ${e instanceof Error ? e.message : String(e)}`)
        return null
      }
      return { host: hook.host, tasks: await readClientTasks(fetch as unknown as HookFetch, hook.url, ids) }
    },
    portal: async (d) => {
      // SSRF-гард: в портал идём только по разрешённым доменам, и только если он нас установил.
      if (!isAllowedPortalHost(d, parseSelfHostedHosts(process.env.B24_SELFHOSTED_HOSTS))) return null
      const record = await getPortalByDomain(portalStore(), d)
      return record ? { call: installerCallFor(record.memberId), origin: `https://${record.domain}` } : null
    },
    // Машинная ссылка портала (в ней токен) — https на сам портал (проверено documentPdfUrl), без редиректов.
    fetchPdf: async (url) => {
      let res: Response
      try {
        res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(PDF_TIMEOUT_MS) })
      } catch (e) {
        // eslint-disable-next-line preserve-caught-error -- cause нельзя: в нём ссылка с токеном
        throw new Error(`document pdf: ${e instanceof Error ? e.name : 'fetch failed'}`)
      }
      if (!res.ok) throw new Error(`document pdf: HTTP ${res.status}`)
      return readLimitedBytes(res as unknown as Parameters<typeof readLimitedBytes>[0], MAX_PDF_BYTES)
    }
  }
}
