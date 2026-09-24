// SSRF-гард адреса портала. Домен приходит от клиента (заголовок X-B24-Domain), и без
// белого списка наш сервер стал бы примитивом «сходи куда скажу» — вплоть до утечки
// собственного токена на чужой хост. Перенесено из client-bank-alfa-by (server/utils/b24Rest.ts).
// Хост вынимается через `URL`, а не регэкспом: `x.bitrix24.by@evil.com` даёт настоящий хост.

/**
 * Зоны облачного Битрикс24. Ведущая точка обязательна: она не пускает `evil-bitrix24.by`
 * и `x.bitrix24.by.attacker.com`. Список — из эталона (зоны DPA Битрикс24 + зоны 1С-Битрикс).
 */
export const B24_CLOUD_HOST_SUFFIXES = [
  '.bitrix24.ru', '.bitrix24.by', '.bitrix24.kz', '.bitrix24.ua',
  '.bitrix24.com', '.bitrix24.eu', '.bitrix24.de', '.bitrix24.fr',
  '.bitrix24.it', '.bitrix24.pl', '.bitrix24.es', '.bitrix24.uk',
  '.bitrix24.com.br', '.bitrix24.com.tr', '.bitrix24.mx', '.bitrix24.co',
  '.bitrix24.cn', '.bitrix24.in', '.bitrix24.id', '.bitrix24.jp',
  '.bitrix24.vn', '.bitrix24.tech'
] as const

/** Голый хост в нижнем регистре; `''`, если разобрать не удалось. */
export function portalHostname(host: string): string {
  const raw = String(host ?? '').trim().replace(/^https?:\/\//i, '')
  if (!raw) return ''
  try {
    return new URL(`https://${raw}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Разбор списка коробочных порталов из окружения (`B24_SELFHOSTED_HOSTS`, через запятую/пробел). */
export function parseSelfHostedHosts(raw: string | undefined): Set<string> {
  const out = new Set<string>()
  for (const token of String(raw ?? '').split(/[\s,]+/)) {
    const h = portalHostname(token)
    if (h) out.add(h)
  }
  return out
}

/** Разрешён ли хост: облачная зона или явно перечисленный коробочный портал. */
export function isAllowedPortalHost(host: string, selfHosted: Set<string> = new Set()): boolean {
  const h = portalHostname(host)
  if (!h) return false
  if (B24_CLOUD_HOST_SUFFIXES.some(suffix => h.endsWith(suffix))) return true
  return selfHosted.has(h)
}

/** Проверяет хост и возвращает ЧИСТОЕ имя — именно его, а не вход, надо подставлять в адрес. */
export function assertPortalHost(host: string, env: Record<string, string | undefined> = process.env): string {
  if (!isAllowedPortalHost(host, parseSelfHostedHosts(env.B24_SELFHOSTED_HOSTS))) {
    throw new Error(`B24 REST refused — host not allow-listed: ${portalHostname(host) || '(unparseable)'}`)
  }
  return portalHostname(host)
}

/**
 * Значение CSP `frame-ancestors` для страниц: встраивать их могут только порталы Битрикс24.
 * Тот же список зон, что у SSRF-гарда, — один источник, чтобы они не разъехались.
 */
export function frameAncestors(selfHostedRaw: string | undefined): string {
  const hosts = [
    ...B24_CLOUD_HOST_SUFFIXES.map(suffix => `https://*${suffix}`),
    ...[...parseSelfHostedHosts(selfHostedRaw)].map(h => `https://${h}`)
  ]
  return `frame-ancestors 'self' ${hosts.join(' ')}`
}
