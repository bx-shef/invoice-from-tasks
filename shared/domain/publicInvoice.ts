// Публичная страница счёта (#34, этап 3): `/p-<домен портала>/i-<ID счёта>` — клиент вводит код
// доступа и видит расшифровку. Здесь — чистые правила: разбор ответов портала и сборка того, что
// увидит клиент. Чтение портала токеном установщика — server/utils/publicInvoice.ts (осознанное
// исключение из «права CRM не расширяем», решение владельца в #34).

import { parseExistingRows } from './invoice'
import { taskPath } from './tasks'
import { camelFieldKey, clientTaskIdOf } from './userFields'
import { isAccessCode } from './appFieldTypes'

/** Ссылка на задачу и её номер у клиента — из приставки названия строки «[123-456] …» (fill.ts). */
export function rowTaskRef(name: string): { taskId: number, clientTaskId: string | null } | null {
  const m = /^\[(\d{1,10})(?:-([A-Za-z0-9_]{1,30}))?\]/.exec(name)
  if (!m) return null
  const taskId = Number(m[1])
  return taskId > 0 ? { taskId, clientTaskId: m[2] ?? null } : null
}

/** Счёт из crm.item.get — только то, что нужно публичной странице. */
export interface PublicInvoiceItem {
  id: number
  title: string
  stageId: string
  /** Дата выставления (`begindate`), `YYYY-MM-DD` или `''`. */
  date: string
  currencyId: string
  opportunity: number
  companyId: number | null
  contactIds: number[]
  myCompanyId: number | null
}

function itemOf(result: unknown): Record<string, unknown> | null {
  const item = result && typeof result === 'object' && 'item' in result ? (result as { item: unknown }).item : result
  return item && typeof item === 'object' ? item as Record<string, unknown> : null
}

function posInt(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function parsePublicInvoice(result: unknown): PublicInvoiceItem | null {
  const o = itemOf(result)
  const id = posInt(o?.id)
  if (!o || !id) return null
  const contacts = Array.isArray(o.contactIds) ? o.contactIds : [o.contactId]
  return {
    id,
    title: typeof o.title === 'string' ? o.title : '',
    stageId: typeof o.stageId === 'string' ? o.stageId : '',
    date: typeof o.begindate === 'string' ? o.begindate.slice(0, 10) : '',
    currencyId: typeof o.currencyId === 'string' ? o.currencyId : '',
    opportunity: Number(o.opportunity) || 0,
    companyId: posInt(o.companyId),
    contactIds: [...new Set(contacts.map(posInt).filter((v): v is number => v !== null))],
    myCompanyId: posInt(o.mycompanyId)
  }
}

/** Компания или контакт клиента: подпись, код доступа и домен портала клиента из UF. */
export interface PublicClient {
  kind: 'company' | 'contact'
  id: number
  title: string
  accessCode: string | null
  domain: string | null
}

/** Домен портала клиента из UF: только имя хоста, без схемы и пути. */
export function clientDomainOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return /^[a-z0-9.-]{3,253}$/.test(v) && v.includes('.') ? v : null
}

/**
 * Разбор компании или контакта (crm.item.get 4 / 3). `codeField` — поле кода доступа,
 * `domainField` — поле домена из настроек (`''` — не выбрано).
 */
export function parsePublicClient(kind: PublicClient['kind'], result: unknown, codeField: string, domainField: string): PublicClient | null {
  const o = itemOf(result)
  const id = posInt(o?.id)
  if (!o || !id) return null
  const title = kind === 'company'
    ? (typeof o.title === 'string' ? o.title : '')
    : [o.name, o.lastName].filter(v => typeof v === 'string' && v).join(' ')
  const code = o[camelFieldKey(codeField)]
  return {
    kind,
    id,
    title,
    accessCode: isAccessCode(code) ? code : null,
    domain: domainField ? clientDomainOf(o[camelFieldKey(domainField)]) : null
  }
}

/** Задача для расшифровки: заголовок, описание, результаты (текстом), ссылка. */
export interface PublicTask {
  id: number
  title: string
  description: string
  results: string[]
  url: string
  /** Номер задачи у клиента и ссылка на неё в его портале (если известен домен). */
  clientTaskId: string | null
  clientTaskUrl: string | null
}

/** Предел текста задачи на странице — описание бывает огромным. */
export const MAX_PUBLIC_TEXT = 4000

/**
 * BB-код портала → простой текст: страница выводит его как текст (никакого HTML от портала),
 * а теги вида [B], [URL=…] клиенту не нужны.
 */
export function plainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\[(\/?)(b|i|u|s|url|img|quote|code|list|\*|color|size|font|user|disk file id)[^\]]*\]/gi, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, MAX_PUBLIC_TEXT)
}

export function parsePublicTask(result: unknown, portalOrigin: string, clientTaskId: string | null, clientDomain: string | null, results: unknown): PublicTask | null {
  const raw = result && typeof result === 'object' && 'task' in result ? (result as { task: unknown }).task : result
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  const id = posInt(o?.id ?? o?.ID)
  if (!o || !id) return null
  const list = Array.isArray(results) ? results : []
  return {
    id,
    title: typeof (o.title ?? o.TITLE) === 'string' ? String(o.title ?? o.TITLE) : '',
    description: plainText(o.description ?? o.DESCRIPTION),
    results: list.map(r => plainText((r as Record<string, unknown> | null)?.text)).filter(Boolean),
    url: `${portalOrigin}${taskPath(id)}`,
    clientTaskId,
    clientTaskUrl: clientTaskId && clientDomain && /^\d+$/.test(clientTaskId) ? `https://${clientDomain}${taskPath(Number(clientTaskId))}` : null
  }
}

/** Строка счёта на странице: название, сумма (цена × количество, с налогом — как в портале). */
export interface PublicRow {
  name: string
  sum: number
  taskId: number | null
  clientTaskId: string | null
}

export function publicRows(raw: unknown): PublicRow[] {
  return parseExistingRows(raw)
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .map((r) => {
      const ref = rowTaskRef(r.productName)
      return {
        name: r.productName,
        // price строки — с налогом (docs/REST_METHODS.md, crm.item.productrow.set) — клиент видит то же, что в счёте.
        sum: Math.round(r.price * r.quantity * 100) / 100,
        taskId: ref?.taskId ?? null,
        clientTaskId: ref?.clientTaskId ?? null
      }
    })
}

/** Название стадии из crm.status.list (`[{ STATUS_ID, NAME }]`). */
export function stageName(raw: unknown, stageId: string): string {
  const list = Array.isArray(raw) ? raw : []
  const hit = list.find(s => (s as Record<string, unknown> | null)?.STATUS_ID === stageId) as Record<string, unknown> | undefined
  return typeof hit?.NAME === 'string' ? hit.NAME : stageId
}

/** Что видит клиент. */
export interface PublicInvoiceView {
  title: string
  date: string
  stage: string
  currencyId: string
  total: number
  company: string | null
  contacts: string[]
  myCompany: string | null
  rows: PublicRow[]
  tasks: PublicTask[]
}

/** ID задач из строк счёта — без дублей, не больше `max` (у каждой — свои запросы в портал). */
export function rowTaskIds(rows: PublicRow[], max: number): number[] {
  return [...new Set(rows.map(r => r.taskId).filter((v): v is number => v !== null))].slice(0, max)
}

/** Номер задачи у клиента для задачи: из строки счёта, иначе из UF задачи (`clientFields.task`). */
export function clientTaskIdFor(rows: PublicRow[], taskId: number, taskRaw: unknown, clientTaskField: string): string | null {
  const fromRow = rows.find(r => r.taskId === taskId && r.clientTaskId)?.clientTaskId
  if (fromRow) return fromRow
  if (!clientTaskField) return null
  const raw = taskRaw && typeof taskRaw === 'object' && 'task' in taskRaw ? (taskRaw as { task: unknown }).task : taskRaw
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return clientTaskIdOf(o[camelFieldKey(clientTaskField)] ?? o[clientTaskField])
}
