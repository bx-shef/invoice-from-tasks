// Пределы входящих запросов к /api — защита одного на всех сервера от переполнения памяти и
// от потока запросов на публичный адрес вебхука (находка отдела безопасности панели: анонимный
// POST на 15 МБ принимался целиком). Чистые функции; применяет их server/middleware/requestLimits.ts.

import type { WindowLimit } from './rateLimit'

/** Тело события портала — PHP-форма в несколько сотен байт; 64 КБ — с большим запасом. */
export const EVENTS_BODY_LIMIT = 64 * 1024
/** Прочие POST: самое крупное — контекст консультации (до 30 тыс. символов) и ставки. */
export const API_BODY_LIMIT = 512 * 1024

/**
 * Частота событий установки и удаления с одного IP (прочие события не считаются —
 * b24EventsHandler.ts). Битрикс24 шлёт их со своих серверов, и лавины установок там не бывает.
 */
export const EVENTS_PER_IP: WindowLimit = { max: 60, windowMs: 60_000 }
/**
 * Общий потолок событий установки и удаления: каждая установка — исходящий запрос к серверу
 * авторизации с нашими client_id/secret. Поток поддельных установок с тысяч адресов не должен
 * превратиться в поток таких запросов — за злоупотребление Битрикс24 может заблокировать ключи.
 */
export const EVENTS_GLOBAL: WindowLimit = { max: 600, windowMs: 60_000 }
/** Живых проверок фрейм-токена (вызовов `profile` в чужой портал) с одного IP. */
export const FRAME_CHECKS_PER_IP: WindowLimit = { max: 60, windowMs: 60_000 }

/** Предел тела для пути; `null` — путь не ограничиваем (страницы, GET). */
export function bodyLimitFor(method: string, path: string): number | null {
  if (method.toUpperCase() !== 'POST' || !path.startsWith('/api/')) return null
  return path.startsWith('/api/b24/events') ? EVENTS_BODY_LIMIT : API_BODY_LIMIT
}

export type BodyVerdict = { ok: true } | { ok: false, status: 411 | 413 }

/**
 * Решение по заголовку `Content-Length`. Без него — 411: и портал, и наша страница его шлют,
 * а тело неизвестной длины пришлось бы читать целиком, чтобы узнать, что оно слишком большое.
 */
export function checkBodySize(contentLength: string | undefined | null, limit: number): BodyVerdict {
  if (contentLength === undefined || contentLength === null || contentLength.trim() === '') return { ok: false, status: 411 }
  const n = Number(contentLength)
  if (!Number.isInteger(n) || n < 0) return { ok: false, status: 411 }
  return n > limit ? { ok: false, status: 413 } : { ok: true }
}

/**
 * Адрес из частной сети: loopback, RFC 1918, CGNAT, link-local, IPv6 ULA (в том числе
 * IPv4-mapped). Только такому соседу — своему прокси, мосту Docker — верим `X-Forwarded-For`.
 */
export function isPrivateAddress(ip: string): boolean {
  let a = String(ip ?? '').trim().toLowerCase()
  if (a.startsWith('::ffff:')) a = a.slice('::ffff:'.length)
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(a)
  if (v4) {
    const o1 = Number(v4[1])
    const o2 = Number(v4[2])
    return o1 === 10 || o1 === 127
      || (o1 === 172 && o2 >= 16 && o2 <= 31)
      || (o1 === 192 && o2 === 168)
      || (o1 === 169 && o2 === 254)
      || (o1 === 100 && o2 >= 64 && o2 <= 127)
  }
  return a === '::1' || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a)
}

/**
 * IP клиента для лимитов.
 *
 * Без доверенного прокси — адрес сокета. С ним (`TRUST_PROXY=1`) — ПОСЛЕДНИЙ адрес из
 * `X-Forwarded-For`: его дописывает наш прокси, а всё, что левее, прислал клиент. h3
 * (`getRequestIP` с `xForwardedFor`) берёт первый — подделываемый, и лимит обходился бы сменой
 * заголовка. Заголовку верим, только если соединение пришло из частной сети: если порт сервера
 * опубликован наружу, клиент, дошедший мимо прокси, иначе назначал бы себе адрес сам (находка
 * /code-review). Схема рассчитана на ОДИН прокси перед сервером (docs/DEPLOY.md).
 */
export function pickClientIp(forwardedFor: string | undefined | null, socketIp: string | undefined | null, trustProxy: boolean): string {
  if (trustProxy && forwardedFor && socketIp && isPrivateAddress(socketIp)) {
    const last = forwardedFor.split(',').map(part => part.trim()).filter(Boolean).pop()
    if (last) return last
  }
  return socketIp || 'unknown'
}
