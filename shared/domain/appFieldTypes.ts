// Свои типы пользовательских полей приложения (#34, этап 2): «Код доступа» к расшифровке счёта и
// «Вебхук клиента» (чтение задач в портале клиента). Типы регистрируются при установке
// (`userfieldtype.add`, если их нет); поля этих типов у компании и контакта создаются ТОЛЬКО
// кнопкой в настройках. Значение поля — строка: код доступа как есть, вебхук — зашифрованный.

/** Короткие коды типов. Портал приводит к нижнему регистру и строит полный `rest_<ID приложения>_<код>`. */
export const ACCESS_CODE_TYPE = 'ift_access_code'
export const CLIENT_HOOK_TYPE = 'ift_client_hook'

/** Тип поля: код, путь обработчика, подписи. */
export interface AppFieldTypeSpec {
  code: typeof ACCESS_CODE_TYPE | typeof CLIENT_HOOK_TYPE
  path: string
  title: string
  description: string
  /** Высота поля в карточке, px (`OPTIONS.height`). */
  height: number
}

export const APP_FIELD_TYPES: readonly AppFieldTypeSpec[] = [
  { code: ACCESS_CODE_TYPE, path: '/uf/access-code', title: 'Код доступа к расшифровке счёта', description: 'Счёт из задач: код для публичной страницы счёта', height: 60 },
  { code: CLIENT_HOOK_TYPE, path: '/uf/client-hook', title: 'Вебхук Битрикс24 клиента', description: 'Счёт из задач: вебхук для чтения задач клиента (хранится зашифрованным)', height: 60 }
]

/** Полный код типа для `crm.*.userfield.add`: `rest_<ID приложения>_<код>` (статья «Как встроить виджет… в виде пользовательского поля»). */
export function fullTypeId(appId: number, code: string): string {
  return `rest_${appId}_${code}`
}

/**
 * Полные коды зарегистрированных типов из userfieldtype.list: код → `rest_<…>_<код>`. Если портал
 * отдал короткий код — строим полный по ID приложения (`appId`); нет и его — типа в ответе нет.
 */
export function registeredTypeIds(existing: unknown, appId: number | null): Map<string, string> {
  const out = new Map<string, string>()
  for (const item of Array.isArray(existing) ? existing : []) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const raw = String(o.USER_TYPE_ID ?? o.userTypeId ?? '').toLowerCase()
    const code = shortCode(raw)
    if (!APP_FIELD_TYPES.some(t => t.code === code)) continue
    if (/^rest_\d+_/.test(raw)) out.set(code, raw)
    else if (appId && appId > 0) out.set(code, fullTypeId(appId, code))
  }
  return out
}

/** Короткий код из записи userfieldtype.list: портал может отдать и полный `rest_<id>_<код>`. */
function shortCode(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/^rest_\d+_/, '')
}

/** Что сделать с типами при установке: добавить отсутствующие, обновить адрес обработчика у устаревших. */
export interface TypeCall {
  method: 'userfieldtype.add' | 'userfieldtype.update'
  params: Record<string, unknown>
}

/**
 * Вызовы регистрации типов. `existing` — ответ userfieldtype.list; `handlerOf` строит абсолютный
 * https-адрес обработчика (`null` — адреса нет, тип не регистрируем). Повторная установка не
 * плодит ошибок «уже есть»: есть с тем же обработчиком — ничего, с другим (переезд) — update.
 */
export function fieldTypeCalls(existing: unknown, handlerOf: (path: string) => string | null): TypeCall[] {
  const have = new Map<string, string>()
  for (const item of Array.isArray(existing) ? existing : []) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    have.set(shortCode(o.USER_TYPE_ID ?? o.userTypeId), String(o.HANDLER ?? o.handler ?? ''))
  }
  const calls: TypeCall[] = []
  for (const spec of APP_FIELD_TYPES) {
    const handler = handlerOf(spec.path)
    if (!handler) continue
    const known = have.get(spec.code)
    const params = {
      USER_TYPE_ID: spec.code,
      HANDLER: handler,
      TITLE: spec.title,
      DESCRIPTION: spec.description,
      OPTIONS: { height: spec.height }
    }
    if (known === undefined) calls.push({ method: 'userfieldtype.add', params })
    else if (known !== handler) calls.push({ method: 'userfieldtype.update', params })
  }
  return calls
}

/** Длина кода доступа (решение владельца, #34). */
export const ACCESS_CODE_LENGTH = 10
/**
 * Алфавит кода: без похожих символов (0/O/o, 1/l/I) — код диктуют и переписывают с бумаги.
 * 56 символов (24 + 24 + 8) в 10 позициях ≈ 58 бит — перебор закрывает лимит попыток публичной
 * страницы (этап 3).
 */
export const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

/**
 * Новый код доступа из криптостойких случайных байт (`crypto.getRandomValues` в браузере).
 * Отбрасываем байты ≥ кратного длине алфавита — без перекоса распределения.
 */
export function generateAccessCode(randomBytes: (n: number) => Uint8Array): string {
  const limit = 256 - (256 % ACCESS_CODE_ALPHABET.length)
  let out = ''
  while (out.length < ACCESS_CODE_LENGTH) {
    for (const b of randomBytes(32)) {
      if (b >= limit) continue
      out += ACCESS_CODE_ALPHABET[b % ACCESS_CODE_ALPHABET.length]
      if (out.length === ACCESS_CODE_LENGTH) break
    }
  }
  return out
}

/** Похоже ли значение на код доступа (разбор поля и ввода на публичной странице). */
export function isAccessCode(value: unknown): value is string {
  return typeof value === 'string' && value.length === ACCESS_CODE_LENGTH && [...value].every(c => ACCESS_CODE_ALPHABET.includes(c))
}

/**
 * Значение поля «Вебхук клиента»: `ift1|<домен портала клиента>|<шифротекст>`. Домен — открытым
 * текстом, чтобы карточка показала «указан для client.bitrix24.ru», не расшифровывая; сам вебхук
 * (в нём секретный код) — только шифротекстом (ключ из окружения, server/utils/clientHook.ts).
 */
export const HOOK_VALUE_PREFIX = 'ift1'

export function formatHookValue(host: string, sealed: string): string {
  return `${HOOK_VALUE_PREFIX}|${host}|${sealed}`
}

/** Разбор значения поля; не наш формат — `null` (поле пустое или испорчено руками). */
export function parseHookValue(value: unknown): { host: string, sealed: string } | null {
  if (typeof value !== 'string') return null
  const parts = value.split('|')
  if (parts.length !== 3 || parts[0] !== HOOK_VALUE_PREFIX || !parts[1] || !parts[2]) return null
  return { host: parts[1], sealed: parts[2] }
}

/**
 * Входящий вебхук Битрикс24: `https://<портал>/rest/<ID пользователя>/<код>/` (документация
 * «Входящие вебхуки»). Возвращает нормализованный адрес и домен; не похоже — `null`. Проверку
 * домена на «это портал Битрикс24» (SSRF) делает сервер — assertPortalHost.
 */
export function parseWebhookUrl(raw: unknown): { url: string, host: string } | null {
  if (typeof raw !== 'string') return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port) return null
  const m = /^\/rest\/(\d{1,10})\/([A-Za-z0-9]{8,64})\/?$/.exec(u.pathname)
  if (!m) return null
  const host = u.hostname.toLowerCase()
  return { url: `https://${host}/rest/${m[1]}/${m[2]}/`, host }
}

/** CRM-сущность поля из PLACEMENT_OPTIONS (`ENTITY_ID`): компания — 4, контакт — 3; иначе `null`. */
export function crmEntityTypeOf(entityId: unknown): 3 | 4 | null {
  const v = String(entityId ?? '').toUpperCase()
  if (v === 'CRM_COMPANY') return 4
  if (v === 'CRM_CONTACT') return 3
  return null
}
