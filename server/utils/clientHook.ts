// Вебхук портала клиента (#34, этап 2): проверка и шифрование перед записью в поле «Вебхук клиента»
// компании или контакта. Ключ — отдельный, `CLIENT_HOOK_ENC_KEY` («примесь» в окружении, решение
// владельца): утечка ключа токенов установки не раскрывает вебхуки клиентов, и наоборот.
// Расшифровка — только на сервере (этап 4, чтение задач клиента); в браузер вебхук не возвращается.

import { formatHookValue, parseHookValue, parseWebhookUrl } from '#shared/domain/appFieldTypes'
import { assertPortalHost } from './b24Host'
import { decryptSecret, encryptSecret, loadEncKey } from './secretCrypto'

export const CLIENT_HOOK_KEY_ENV = 'CLIENT_HOOK_ENC_KEY'

export type SealResult
  = | { ok: true, value: string, host: string }
    | { ok: false, status: 400 | 503, error: string }

/**
 * Вебхук → значение поля `ift1|<домен>|<шифротекст>`. Домен обязан быть порталом Битрикс24
 * (assertPortalHost — тот же SSRF-гард, что у установки): иначе по полю потом ходили бы куда угодно.
 */
export function sealClientHook(raw: unknown, env: Record<string, string | undefined> = process.env): SealResult {
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
  return { ok: true, value: formatHookValue(hook.host, encryptSecret(hook.url, key)), host: hook.host }
}

/**
 * Значение поля → вебхук. Бросает на чужом формате, чужом ключе и подменённом домене: домен из
 * открытой части обязан совпасть с доменом расшифрованного адреса — иначе подпись «указан для …»
 * в карточке врала бы.
 */
export function openClientHook(value: unknown, env: Record<string, string | undefined> = process.env): { url: string, host: string } {
  const parsed = parseHookValue(value)
  if (!parsed) throw new Error('client hook: not our value format')
  const hook = parseWebhookUrl(decryptSecret(parsed.sealed, loadEncKey(env, CLIENT_HOOK_KEY_ENV)))
  if (!hook || hook.host !== parsed.host) throw new Error('client hook: host mismatch')
  return hook
}
