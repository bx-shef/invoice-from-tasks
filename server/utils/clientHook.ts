// Вебхук портала клиента (#34, этап 2): проверка и шифрование перед записью в поле «Вебхук клиента»
// компании или контакта. Ключ — отдельный, `CLIENT_HOOK_ENC_KEY` («примесь» в окружении, решение
// владельца): утечка ключа токенов установки не раскрывает вебхуки клиентов, и наоборот.
// Расшифровка — только на сервере (этап 4, чтение задач клиента); в браузер вебхук не возвращается.

import { formatHookValue, parseHookValue, parseWebhookUrl } from '#shared/domain/appFieldTypes'
import { assertPortalHost } from './b24Host'
import { decryptSecret, encryptSecret, loadEncKey } from './secretCrypto'

export const CLIENT_HOOK_KEY_ENV = 'CLIENT_HOOK_ENC_KEY'

/** Лимит шифрований на сотрудника (seal.post.ts): 20 в минуту. */
export const SEAL_LIMIT = { max: 20, windowMs: 60_000 } as const

export type SealResult
  = | { ok: true, value: string, host: string }
    | { ok: false, status: 400 | 503, error: string }

/**
 * Открытые данные шифротекста (GCM AAD): портал, где вебхук сохранён, и домен вебхука. Значение
 * поля, скопированное в другой портал с нашим приложением (читается любым с доступом к CRM и
 * выгрузкой), там не расшифруется (находка /code-review).
 */
function hookAad(portalDomain: string, hookHost: string): string {
  return `ift1|${portalDomain.toLowerCase()}|${hookHost}`
}

/**
 * Вебхук → значение поля `ift1|<домен>|<шифротекст>`. Домен обязан быть порталом Битрикс24
 * (assertPortalHost — тот же SSRF-гард, что у установки): иначе по полю потом ходили бы куда угодно.
 *
 * @param portalDomain домен НАШЕГО портала (из проверенного фрейм-токена) — привязка шифротекста
 */
export function sealClientHook(raw: unknown, portalDomain: string, env: Record<string, string | undefined> = process.env): SealResult {
  const hook = parseWebhookUrl(raw)
  if (!hook) return { ok: false, status: 400, error: 'Это не входящий вебхук Битрикс24: нужен адрес вида https://портал.bitrix24.ru/rest/1/код/' }
  try {
    assertPortalHost(hook.host, env)
  } catch {
    return { ok: false, status: 400, error: 'Домен вебхука — не портал Битрикс24' }
  }
  let key: Buffer
  try {
    key = loadEncKey(env, CLIENT_HOOK_KEY_ENV)
  } catch {
    return { ok: false, status: 503, error: 'На сервере не задан ключ шифрования вебхуков (CLIENT_HOOK_ENC_KEY)' }
  }
  return { ok: true, value: formatHookValue(hook.host, encryptSecret(hook.url, key, hookAad(portalDomain, hook.host))), host: hook.host }
}

/**
 * Значение поля → вебхук. Бросает на чужом формате, чужом ключе, чужом портале (AAD) и подменённом
 * домене: домен из открытой части обязан совпасть с доменом расшифрованного адреса — иначе подпись
 * «указан для …» в карточке врала бы. SSRF-гард — ещё раз, при использовании: домен, убранный из
 * B24_SELFHOSTED_HOSTS после сохранения, больше не годится (находка /code-review).
 */
export function openClientHook(value: unknown, portalDomain: string, env: Record<string, string | undefined> = process.env): { url: string, host: string } {
  const parsed = parseHookValue(value)
  if (!parsed) throw new Error('client hook: not our value format')
  const hook = parseWebhookUrl(decryptSecret(parsed.sealed, loadEncKey(env, CLIENT_HOOK_KEY_ENV), hookAad(portalDomain, parsed.host)))
  if (!hook || hook.host !== parsed.host) throw new Error('client hook: host mismatch')
  assertPortalHost(hook.host, env)
  return hook
}
