// Публичная страница счёта (#34, этап 3): `/p-<домен портала>/i-<ID счёта>` — клиент вводит код
// доступа и видит расшифровку. Здесь — чистые правила: разбор ответов портала и сборка того, что
// увидит клиент. Чтение портала токеном установщика — server/utils/publicInvoice.ts (осознанное
// исключение из «права CRM не расширяем», решение владельца в #34).

import { parseExistingRows } from './invoice'
import { crmBindingCodes, DEAL_ENTITY_TYPE_ID, INVOICE_ENTITY_TYPE_ID, TASK_COMPLETED, TASK_STATUS_LABELS, taskPath } from './tasks'
import { camelFieldKey, CLIENT_HOOK_FIELD, clientTaskIdOf } from './userFields'
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
  /** Сделка счёта (`parentId2`) — задачи сделки тоже относятся к счёту. */
  dealId: number | null
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
    myCompanyId: posInt(o.mycompanyId),
    dealId: posInt(o.parentId2)
  }
}

/**
 * Коды привязки, по которым задача считается задачей ЭТОГО счёта: сам счёт и его сделка
 * (crmBindingCodes, как при заполнении). Задача из строки «[123] …» без такой привязки клиенту не
 * показывается: номер в названии строки может вписать кто угодно, а читаем мы токеном
 * администратора (находка ревью безопасности).
 */
export function invoiceBindingCodes(invoice: Pick<PublicInvoiceItem, 'id' | 'dealId'>): string[] {
  return [
    ...crmBindingCodes(INVOICE_ENTITY_TYPE_ID, invoice.id),
    ...(invoice.dealId ? crmBindingCodes(DEAL_ENTITY_TYPE_ID, invoice.dealId) : [])
  ]
}

/** Привязана ли задача (ответ tasks.task.get) к счёту: `ufCrmTask` / `UF_CRM_TASK` содержит код. */
export function taskBoundTo(taskRaw: unknown, codes: string[]): boolean {
  const raw = taskRaw && typeof taskRaw === 'object' && 'task' in taskRaw ? (taskRaw as { task: unknown }).task : taskRaw
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const list = o.ufCrmTask ?? o.UF_CRM_TASK
  const bound = (Array.isArray(list) ? list : []).map(v => String(v).toLowerCase())
  const wanted = new Set(codes.map(c => c.toLowerCase()))
  return bound.some(b => wanted.has(b))
}

/** Компания или контакт клиента: подпись, код доступа и вебхук портала клиента (зашифрованный) из UF. */
export interface PublicClient {
  kind: 'company' | 'contact'
  id: number
  title: string
  accessCode: string | null
  /** Значение поля «Вебхук клиента» как есть (`ift1|домен|шифротекст`); расшифровывает сервер. */
  hook?: string | null
}

/** Домен портала клиента из UF: только имя хоста, без схемы и пути. */
export function clientDomainOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return /^[a-z0-9.-]{3,253}$/.test(v) && v.includes('.') ? v : null
}

/** Разбор компании или контакта (crm.item.get 4 / 3). `codeField` — поле кода доступа. */
export function parsePublicClient(kind: PublicClient['kind'], result: unknown, codeField: string): PublicClient | null {
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
    hook: typeof o[camelFieldKey(CLIENT_HOOK_FIELD)] === 'string' && o[camelFieldKey(CLIENT_HOOK_FIELD)] ? String(o[camelFieldKey(CLIENT_HOOK_FIELD)]) : null
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
  /** Задача в портале клиента, прочитанная его вебхуком (этап 4); `null` — вебхука нет или не прочиталась. */
  clientTask?: ClientTaskView | null
}

/** Задача клиента для страницы: постановщик со стороны клиента, состояние, дата принятия. */
export interface ClientTaskView {
  title: string
  description: string
  results: string[]
  creatorName: string
  /** Аватар постановщика — только https-адрес; иначе `null`. */
  creatorIcon: string | null
  /** Состояние по-русски: «принята» (завершена), «требует принятия» (ждёт контроля), «поставлена» … */
  state: string
  /** Дата принятия (`closedDate` завершённой задачи), `YYYY-MM-DD`; не принята — `null`. */
  acceptedAt: string | null
}

/**
 * Состояние задачи клиента словами владельца (#34): завершена — «принята», ждёт контроля —
 * «требует принятия», новая или ждёт выполнения — «поставлена», остальное — как в карточке.
 */
export function clientTaskState(status: number | null): string {
  if (status === TASK_COMPLETED) return 'принята'
  if (status === 4) return 'требует принятия'
  if (status === 1 || status === 2) return 'поставлена'
  return status !== null ? (TASK_STATUS_LABELS[status] ?? `статус ${status}`) : 'неизвестно'
}

/** https-адрес картинки из ответа чужого портала; другое (javascript:, data:, http:) — `null`. */
export function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * Задача клиента из tasks.task.get его вебхуком (замер 2026-10-06: `{ task: { title, status,
 * closedDate, creator: { name, icon } } }`). Ответ чужого портала — недоверенный: текст без HTML
 * и с пределами, картинка — только https.
 */
export function parseClientTask(raw: unknown, results: unknown): ClientTaskView | null {
  const t = raw && typeof raw === 'object' && 'task' in raw ? (raw as { task: unknown }).task : raw
  const o = t && typeof t === 'object' ? t as Record<string, unknown> : null
  if (!o || !posInt(o.id ?? o.ID)) return null
  const creator = o.creator && typeof o.creator === 'object' ? o.creator as Record<string, unknown> : {}
  const statusNum = Number(o.status ?? o.STATUS)
  const status = Number.isInteger(statusNum) && statusNum > 0 ? statusNum : null
  const closed = typeof o.closedDate === 'string' ? o.closedDate.slice(0, 10) : ''
  const list = Array.isArray(results) ? results : (results as { items?: unknown } | null)?.items
  return {
    title: plainText(o.title ?? o.TITLE).slice(0, 500),
    description: plainText(o.description ?? o.DESCRIPTION),
    results: (Array.isArray(list) ? list : []).map(r => plainText((r as Record<string, unknown> | null)?.text)).filter(Boolean).slice(0, 20),
    creatorName: plainText(creator.name).slice(0, 200),
    creatorIcon: httpsUrl(creator.icon),
    state: clientTaskState(status),
    acceptedAt: status === TASK_COMPLETED && /^\d{4}-\d{2}-\d{2}$/.test(closed) ? closed : null
  }
}

/** Предел текста задачи на странице — описание бывает огромным. */
export const MAX_PUBLIC_TEXT = 4000

/**
 * BB-код портала → простой текст: страница выводит его как текст (никакого HTML от портала),
 * а теги вида [B], [URL=…] клиенту не нужны.
 */
export function plainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  // Имя тега — целиком (за ним только `=` или `]`): «[important]» и «[list of changes]» —
  // обычный текст, а не теги (находка /code-review).
  return value
    .replace(/\[\/?(?:b|i|u|s|url|img|quote|code|list|\*|color|size|font|user|table|tr|td|th|p|left|right|center|justify)(?:=[^\]]*)?\]|\[disk file id=[^\]]*\]/gi, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, MAX_PUBLIC_TEXT)
}

/** @param taskDomainField поле задачи с доменом портала клиента (настройка `clientFields.taskDomain`) */
export function parsePublicTask(result: unknown, portalOrigin: string, clientTaskId: string | null, results: unknown, taskDomainField = ''): PublicTask | null {
  const raw = result && typeof result === 'object' && 'task' in result ? (result as { task: unknown }).task : result
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  const id = posInt(o?.id ?? o?.ID)
  if (!o || !id) return null
  const clientDomain = taskDomainField ? clientDomainOf(o[camelFieldKey(taskDomainField)] ?? o[taskDomainField]) : null
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
  /** Позиций больше, чем показано (MAX_PUBLIC_ROWS): итог — по всему счёту. */
  truncated: boolean
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

/**
 * Команда пакета `batch` (REST v2): `метод?параметры` в виде строки запроса, массивы — `key[]=`,
 * объекты — `key[sub]=` (как ждёт портал; документация метода batch).
 */
export function batchCommand(method: string, params: Record<string, unknown>): string {
  const q = new URLSearchParams()
  const put = (key: string, v: unknown): void => {
    if (Array.isArray(v)) v.forEach(x => put(`${key}[]`, x))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) put(`${key}[${k}]`, x)
    else if (v !== undefined && v !== null) q.append(key, String(v))
  }
  for (const [k, v] of Object.entries(params)) put(k, v)
  return `${method}?${q.toString()}`
}
