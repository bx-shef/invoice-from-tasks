// Пользовательские поля (UF), которые использует приложение: ID задачи клиента (UF задачи) и
// домен портала клиента (UF компании и контакта). Какое поле брать — выбирает администратор
// в настройках; поля приложения создаются ТОЛЬКО кнопкой в настройках (решение владельца, #34) —
// при установке и удалении приложение UF не трогает.

/** Код UF: `UF_` и заглавные латиница, цифры, `_`; предел — 50 символов (документация crm.*.userfield.add). */
const FIELD_NAME_RE = /^UF_[A-Z0-9_]{1,47}$/

export function isFieldName(value: unknown): value is string {
  return typeof value === 'string' && FIELD_NAME_RE.test(value)
}

/** Код поля из настроек: пустая строка — поле не выбрано. */
export function normalizeFieldName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const v = value.trim().toUpperCase()
  return isFieldName(v) ? v : ''
}

/**
 * Ключ UF в ответе tasks.task.list: портал отдаёт поля в camelCase — `UF_CRM_TASK` → `ufCrmTask`
 * (так уже читается привязка к CRM, tasks.ts). Разбор ищет и исходный код — на случай ответа как есть.
 */
export function camelFieldKey(fieldName: string): string {
  return fieldName.toLowerCase().replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** Поле для выпадающего списка настроек. */
export interface UserFieldOption {
  name: string
  /** Подпись поля в портале; нет — код. */
  label: string
  type: string
}

/** Подпись: строка или словарь по языкам (`{ ru: '…' }`), берём русскую, иначе первую. */
function labelOf(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object') {
    const map = value as Record<string, unknown>
    const first = map.ru ?? Object.values(map)[0]
    return typeof first === 'string' ? first.trim() : ''
  }
  return ''
}

/**
 * Разбор списков UF (task.item.userfield.getlist, crm.company.userfield.list,
 * crm.contact.userfield.list): только строковые поля и поля-числа — ID задачи и домен в другие типы
 * не пишутся. Порядок — по подписи; повтор кода отбрасывается (первый побеждает).
 */
export function parseUserFields(raw: unknown, types: readonly string[] = TEXT_FIELD_TYPES): UserFieldOption[] {
  if (!Array.isArray(raw)) return []
  const out = new Map<string, UserFieldOption>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = normalizeFieldName(o.FIELD_NAME)
    const type = typeof o.USER_TYPE_ID === 'string' ? o.USER_TYPE_ID : ''
    if (!name || !types.includes(type) || o.MULTIPLE === 'Y' || out.has(name)) continue
    const label = labelOf(o.EDIT_FORM_LABEL) || labelOf(o.LIST_COLUMN_LABEL) || labelOf(o.LABEL) || name
    out.set(name, { name, label, type })
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'))
}

/** Типы UF, из которых читаем ID задачи клиента и домен. */
export const TEXT_FIELD_TYPES = ['string', 'integer', 'double', 'url'] as const

/** Приставка подписей полей приложения — по ней их видно в портале (просьба владельца, #34). */
export const APP_FIELD_LABEL_PREFIX = '[sh::invoice-from-task]'

/** Поле приложения: где создаётся, код, подпись и тип. */
export interface AppFieldSpec {
  entity: 'task' | 'company' | 'contact'
  /** Полный код с приставкой `UF_` (у CRM — `UF_CRM_`: её добавляет портал). */
  name: string
  label: string
  type: 'string'
}

/** Поля, которые создаёт кнопка «Создать поля». */
export const APP_FIELDS: readonly AppFieldSpec[] = [
  { entity: 'task', name: 'UF_SH_IFT_CLIENT_TASK', label: `${APP_FIELD_LABEL_PREFIX} ID Клиентской задачи`, type: 'string' },
  { entity: 'company', name: 'UF_CRM_SH_IFT_CLIENT_DOMAIN', label: `${APP_FIELD_LABEL_PREFIX} Домен Битрикс24 клиента`, type: 'string' },
  { entity: 'contact', name: 'UF_CRM_SH_IFT_CLIENT_DOMAIN', label: `${APP_FIELD_LABEL_PREFIX} Домен Битрикс24 клиента`, type: 'string' }
]

/** Каких полей приложения нет в портале — их и создаёт кнопка; есть — не трогаем. */
export function missingAppFields(existing: Record<AppFieldSpec['entity'], readonly string[]>): AppFieldSpec[] {
  return APP_FIELDS.filter(f => !existing[f.entity].includes(f.name))
}

/** ID задачи клиента из значения UF: строка или число, без пробелов; пусто или мусор — `null`. */
export function clientTaskIdOf(value: unknown): string | null {
  const v = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : ''
  // Номер задачи клиента — его ID в портале клиента, но бывает и с приставкой («CL-12»): пропускаем
  // латиницу, цифры, `-` и `_`, не длиннее 30 — в название строки счёта не попадёт ничего чужого.
  return /^[A-Za-z0-9_-]{1,30}$/.test(v) ? v : null
}
