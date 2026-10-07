// Пользовательские поля (UF), которые использует приложение: ID задачи клиента (UF задачи) и
// домен портала клиента (UF компании и контакта). Какое поле брать — выбирает администратор
// в настройках; поля приложения создаются ТОЛЬКО кнопкой в настройках (решение владельца, #34) —
// при установке и удалении приложение UF не трогает.

import { ACCESS_CODE_TYPE, CLIENT_HOOK_TYPE, ECONOMICS_TYPE } from './appFieldTypes'

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

/**
 * Типы UF, из которых читаем ID задачи клиента и домен. `double` — тоже: номер задачи клиента на
 * портале владельца хранится в числовом поле (`UF_SOURCE_TASK_ID`, замер 2026-10-06: значение
 * в списке задач — строка «120536»); целое с нулевой дробью («456.0000») clientTaskIdOf понимает.
 */
export const TEXT_FIELD_TYPES = ['string', 'integer', 'double', 'url', 'money'] as const

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

/** Приставка подписей полей приложения — по ней их видно в портале (просьба владельца, #34). */
export const APP_FIELD_LABEL_PREFIX = '[sh::invoice-from-task]'

/** Системные типы полей приложения (остальные — свои типы, appFieldTypes.ts). */
export const SYSTEM_FIELD_TYPES = ['string', 'url', 'boolean', 'datetime', 'double'] as const
export type SystemFieldType = typeof SYSTEM_FIELD_TYPES[number]

/** Поля счёта: объект UF нового счёта в userfieldconfig — `CRM_SMART_INVOICE`, коды — `UF_CRM_SMART_INVOICE_…`. */
export const INVOICE_UF_ENTITY = 'CRM_SMART_INVOICE'
export const INVOICE_LINK_FIELD = 'UF_CRM_SMART_INVOICE_SH_IFT_LINK'
export const INVOICE_QR_FIELD = 'UF_CRM_SMART_INVOICE_SH_IFT_QR'
export const INVOICE_APPROVED_FIELD = 'UF_CRM_SMART_INVOICE_SH_IFT_OK'
export const INVOICE_APPROVED_AT_FIELD = 'UF_CRM_SMART_INVOICE_SH_IFT_OK_AT'
export const INVOICE_ECONOMICS_FIELD = 'UF_CRM_SMART_INVOICE_SH_IFT_ECON'

/** Поля экономики задачи (решение владельца 2026-10-07). */
export const TASK_WORK_COST_FIELD = 'UF_SH_IFT_WORK_COST'
export const TASK_DIFF_PERCENT_FIELD = 'UF_SH_IFT_DIFF_PCT'
export const TASK_DELTA_FIELD = 'UF_SH_IFT_DELTA'

/** Поле приложения: где создаётся, код, подпись и тип. */
export interface AppFieldSpec {
  entity: 'task' | 'company' | 'contact' | 'invoice'
  /** Полный код с приставкой `UF_` (у CRM — `UF_CRM_`: её добавляет портал). */
  name: string
  label: string
  /**
   * Тип: `string` — системный; иначе короткий код своего типа приложения (appFieldTypes.ts) —
   * полный `rest_<ID приложения>_<код>` строится при создании (`fullTypeId`).
   */
  type: SystemFieldType | typeof ACCESS_CODE_TYPE | typeof CLIENT_HOOK_TYPE | typeof ECONOMICS_TYPE
}

/** Коды полей своих типов у компании и контакта — одинаковые: публичная страница ищет по ним. */
export const ACCESS_CODE_FIELD = 'UF_CRM_SH_IFT_ACCESS_CODE'
export const CLIENT_HOOK_FIELD = 'UF_CRM_SH_IFT_CLIENT_HOOK'

/** Поля, которые создаёт кнопка «Создать поля». */
export const APP_FIELDS: readonly AppFieldSpec[] = [
  { entity: 'task', name: 'UF_SH_IFT_CLIENT_TASK', label: `${APP_FIELD_LABEL_PREFIX} ID Клиентской задачи`, type: 'string' },
  { entity: 'task', name: 'UF_SH_IFT_CLIENT_DOMAIN', label: `${APP_FIELD_LABEL_PREFIX} Домен Битрикс24 клиента`, type: 'string' },
  { entity: 'task', name: TASK_WORK_COST_FIELD, label: `${APP_FIELD_LABEL_PREFIX} Стоимость работ`, type: 'double' },
  { entity: 'task', name: TASK_DIFF_PERCENT_FIELD, label: `${APP_FIELD_LABEL_PREFIX} Разница с формулой, %`, type: 'double' },
  { entity: 'task', name: TASK_DELTA_FIELD, label: `${APP_FIELD_LABEL_PREFIX} Дельта с формулой`, type: 'double' },
  ...(['company', 'contact'] as const).flatMap((entity): AppFieldSpec[] => [
    { entity, name: ACCESS_CODE_FIELD, label: `${APP_FIELD_LABEL_PREFIX} Код доступа к расшифровке счёта`, type: ACCESS_CODE_TYPE },
    { entity, name: CLIENT_HOOK_FIELD, label: `${APP_FIELD_LABEL_PREFIX} Вебхук Битрикс24 клиента`, type: CLIENT_HOOK_TYPE }
  ]),
  { entity: 'invoice', name: INVOICE_LINK_FIELD, label: `${APP_FIELD_LABEL_PREFIX} Ссылка на расшифровку`, type: 'url' },
  { entity: 'invoice', name: INVOICE_QR_FIELD, label: `${APP_FIELD_LABEL_PREFIX} QR-код расшифровки`, type: 'url' },
  { entity: 'invoice', name: INVOICE_APPROVED_FIELD, label: `${APP_FIELD_LABEL_PREFIX} Согласовано клиентом`, type: 'boolean' },
  { entity: 'invoice', name: INVOICE_APPROVED_AT_FIELD, label: `${APP_FIELD_LABEL_PREFIX} Дата согласования`, type: 'datetime' },
  { entity: 'invoice', name: INVOICE_ECONOMICS_FIELD, label: `${APP_FIELD_LABEL_PREFIX} Экономика счёта`, type: ECONOMICS_TYPE }
]

/**
 * Каких полей приложения нет в портале — их и создаёт кнопка; есть — не трогаем. `existing` —
 * коды ВСЕХ UF сущности (`fieldNames`), а не только подходящих для выбора: поле приложения,
 * изменённое в портале на другой тип, всё равно «есть» — повторное создание дало бы ошибку.
 */
export function missingAppFields(existing: Record<AppFieldSpec['entity'], readonly string[]>): AppFieldSpec[] {
  return APP_FIELDS.filter(f => !existing[f.entity].includes(f.name))
}

/** Коды всех UF из ответа списка — для проверки «поле уже есть» (любой тип). */
export function fieldNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => normalizeFieldName((item as Record<string, unknown> | null)?.FIELD_NAME)).filter(Boolean)
}

/** ID задачи клиента из значения UF: строка или число, без пробелов; пусто или мусор — `null`. */
export function clientTaskIdOf(value: unknown): string | null {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : ''
  // Числовое поле (`double`) может прийти как «456.0000» — это номер 456; дробный — не номер.
  const v = /^\d+\.0+$/.test(raw) ? raw.replace(/\.0+$/, '') : raw
  // Номер задачи клиента — его ID в портале клиента, бывает и с приставкой («CL_12»): пропускаем
  // латиницу, цифры и `_`, не длиннее 30 — в название строки счёта не попадёт ничего чужого.
  // `-` нет: это разделитель в «[102-456]», с ним «[102-12-5]» не разобрать (находка /code-review).
  return /^[A-Za-z0-9_]{1,30}$/.test(v) ? v : null
}
