// Публичная страница счёта (#34, этап 3): `/p-<домен портала>/i-<ID счёта>` — клиент вводит код
// доступа и видит расшифровку. Здесь — чистые правила: разбор ответов портала и сборка того, что
// увидит клиент. Чтение портала токеном установщика — server/utils/publicInvoice.ts (осознанное
// исключение из «права CRM не расширяем», решение владельца в #34).

import { parseExistingRows } from './invoice'
import { crmBindingCodes, DEAL_ENTITY_TYPE_ID, INVOICE_ENTITY_TYPE_ID, TASK_COMPLETED, TASK_STATUS_LABELS, taskPath } from './tasks'
import { camelFieldKey, CLIENT_HOOK_FIELD, clientTaskIdOf } from './userFields'
import { isAccessCode } from './appFieldTypes'
import type { ApprovalComment, ApprovalMark } from './approval'

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
  /** Номер счёта (`accountNumber`, «70») — не ID элемента; пусто — номер не присвоен. */
  number: string
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
  /** Ответственный за счёт — на него дело с комментарием клиента (режим согласования). */
  assignedById: number | null
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
    number: typeof o.accountNumber === 'string' || typeof o.accountNumber === 'number' ? String(o.accountNumber).trim() : '',
    stageId: typeof o.stageId === 'string' ? o.stageId : '',
    date: typeof o.begindate === 'string' ? o.begindate.slice(0, 10) : '',
    currencyId: typeof o.currencyId === 'string' ? o.currencyId : '',
    opportunity: Number(o.opportunity) || 0,
    companyId: posInt(o.companyId),
    contactIds: [...new Set(contacts.map(posInt).filter((v): v is number => v !== null))],
    myCompanyId: posInt(o.mycompanyId),
    dealId: posInt(o.parentId2),
    assignedById: posInt(o.assignedById)
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
  /** Состояние словами клиента (как у его задачи): «принята», «требует принятия», «поставлена»… */
  state: string
  /** Дата для строки: закрытия, если закрыта, иначе постановки (`YYYY-MM-DD`); нет — `''`. */
  date: string
  /** Номер задачи у клиента и ссылка на неё в его портале (если известен домен). */
  clientTaskId: string | null
  clientTaskUrl: string | null
  /** Задача в портале клиента, прочитанная его вебхуком (этап 4); `null` — вебхука нет или не прочиталась. */
  clientTask?: ClientTaskView | null
}

/** Статус «ждёт контроля» (REST v2) — для клиента «требует принятия». */
const TASK_AWAITING_CONTROL = 4

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
  if (status === TASK_AWAITING_CONTROL) return 'требует принятия'
  if (status === 1 || status === 2) return 'поставлена'
  return status !== null ? (TASK_STATUS_LABELS[status] ?? `статус ${status}`) : 'неизвестно'
}

/**
 * Аватар из ответа портала клиента — только с САМОГО портала (`host`), относительный путь —
 * от него же: адрес со стороннего хоста был бы пикселем слежки за клиентом (находка ревью).
 */
export function portalImage(value: unknown, host: string): string | null {
  if (!host || typeof value !== 'string' || !value) return null
  let u: URL
  try {
    u = new URL(value, `https://${host}`)
  } catch {
    return null
  }
  return u.protocol === 'https:' && u.hostname === host && !u.username && !u.password ? u.toString() : null
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
export function parseClientTask(raw: unknown, results: unknown, host = ''): ClientTaskView | null {
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
    creatorIcon: portalImage(creator.icon, host),
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
    // HTML-сущности из ответа портала (`&#91;`, `&nbsp;`) — страница выводит текстом, клиент видел их как есть
    .replace(/&(#\d{1,6}|#x[0-9a-f]{1,6}|nbsp|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
      const k = e.toLowerCase()
      if (k.startsWith('#x')) return String.fromCodePoint(Number.parseInt(k.slice(2), 16))
      if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)))
      return ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' } as Record<string, string>)[k] ?? _m
    })
    .trim()
    .slice(0, MAX_PUBLIC_TEXT)
}

/** Состояние и дата задачи для строки страницы — ответ tasks.task.get (camelCase или UPPER). */
function taskStateAndDate(o: Record<string, unknown>): { state: string, date: string } {
  const n = Number(o.status ?? o.STATUS)
  const status = Number.isInteger(n) && n > 0 ? n : null
  const day = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : ''
  const closed = status === TASK_COMPLETED ? day(o.closedDate ?? o.CLOSED_DATE) : ''
  return { state: status === null ? '' : clientTaskState(status), date: closed || day(o.createdDate ?? o.CREATED_DATE) }
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
    ...taskStateAndDate(o),
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

/** Документ счёта для скачивания: последний по каждому разрешённому шаблону. */
export interface PublicDocument {
  id: number
  title: string
  templateId: number
}

/** Что видит клиент. */
export interface PublicInvoiceView {
  /** PDF документов по шаблонам из настроек (этап 5). */
  documents?: PublicDocument[]
  /** Позиций больше, чем показано (MAX_PUBLIC_ROWS): итог — по всему счёту. */
  truncated: boolean
  title: string
  /** Номер счёта для клиента (`accountNumber`); пусто — показываем ID. */
  number: string
  date: string
  stage: string
  currencyId: string
  total: number
  company: string | null
  contacts: string[]
  myCompany: string | null
  rows: PublicRow[]
  tasks: PublicTask[]
  /** Режим согласования: комментарии клиента и ответы. Не в стадии согласования — нет. */
  approval?: {
    comments: ApprovalComment[]
    mark: ApprovalMark
    /** Решения клиента по задачам; `null` — в счёте нет поля решений (кнопок по задачам нет). */
    decisions?: Record<number, 'yes' | 'no'> | null
  } | null
}

/** ID задач из строк счёта — без дублей, не больше `max` (у каждой — свои запросы в портал). */
export function rowTaskIds(rows: PublicRow[], max: number): number[] {
  return [...new Set(rows.map(r => r.taskId).filter((v): v is number => v !== null))].slice(0, max)
}

/** Номер задачи у клиента для задачи: из строки счёта, иначе из UF задачи (`clientFields.task`). */
/**
 * Номер задачи клиента для задачи. Поле выбрано в настройках — ТОЛЬКО из поля нашей задачи (она
 * уже проверена на привязку к счёту, taskBoundTo): по этому номеру вебхук клиента читает задачу в
 * его портале, и вписанный руками в название строки «[123-999]» не должен открывать чужую задачу
 * клиента (находка ревью этапа 4). Поле не выбрано — номер из названия строки, но тогда и домена
 * нет (он тоже из поля задачи), и вебхук не вызывается — только показ номера.
 */
export function clientTaskIdFor(rows: PublicRow[], taskId: number, taskRaw: unknown, clientTaskField: string): string | null {
  if (!clientTaskField) return rows.find(r => r.taskId === taskId && r.clientTaskId)?.clientTaskId ?? null
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

/** Список документов (crm.documentgenerator.document.list → `{ documents: [...] }`). */
export function documentEntries(raw: unknown): Record<string, unknown>[] {
  return documentList(raw)
}

function documentList(raw: unknown): Record<string, unknown>[] {
  const list = raw && typeof raw === 'object' && 'documents' in raw ? (raw as { documents: unknown }).documents : raw
  return (Array.isArray(list) ? list : []).filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
}

/**
 * Последний документ (наибольший ID) по каждому разрешённому шаблону — только с готовым PDF
 * (`pdfId`) и только этого счёта: ответ портала перепроверяем, а не верим фильтру.
 */
export function latestDocuments(raw: unknown, templates: number[], invoiceId: number): PublicDocument[] {
  const best = new Map<number, PublicDocument>()
  for (const d of documentList(raw)) {
    const id = posInt(d.id)
    const templateId = posInt(d.templateId)
    if (!id || !templateId || !templates.includes(templateId) || !posInt(d.pdfId)) continue
    if (Number(d.entityTypeId) !== INVOICE_ENTITY_TYPE_ID || Number(d.entityId) !== invoiceId) continue
    const prev = best.get(templateId)
    if (!prev || id > prev.id) best.set(templateId, { id, title: plainText(d.title).slice(0, 200) || `Документ ${id}`, templateId })
  }
  return templates.map(t => best.get(t)).filter((d): d is PublicDocument => !!d)
}

/**
 * Можно ли отдать документ (crm.documentgenerator.document.get → `{ document }`): этого счёта,
 * разрешённого шаблона, с PDF, и машинная ссылка — https на САМ портал (её сервер скачивает
 * токеном из ссылки; на другой хост не ходим — SSRF). Иначе `null`.
 */
export function documentPdfUrl(raw: unknown, templates: number[], invoiceId: number, portalHost: string): { url: string, title: string } | null {
  const r = documentPdfCheck(raw, templates, invoiceId, portalHost)
  return r.ok ? { url: r.url, title: r.title } : null
}

/**
 * То же с причиной отказа — для журнала (без самой ссылки: в ней токен). На живом портале
 * (2026-10-06, счёт 145) скачивание отказывало, а причину было не узнать (находка владельца).
 */
/** Что скачать: PDF или картинку-превью документа (`imageUrlMachine`). */
export type DocumentKind = 'pdf' | 'image'

export function documentPdfCheck(raw: unknown, templates: number[], invoiceId: number, portalHost: string, kind: DocumentKind = 'pdf'): { ok: true, url: string, title: string } | { ok: false, reason: string } {
  const d = raw && typeof raw === 'object' && 'document' in raw ? (raw as { document: unknown }).document : raw
  const o = d && typeof d === 'object' ? d as Record<string, unknown> : null
  if (!o) return { ok: false, reason: 'no document' }
  const templateId = posInt(o.templateId)
  if (!templateId || !templates.includes(templateId)) return { ok: false, reason: `template ${String(o.templateId)} not allowed` }
  // `pdfId` — только в ответе списка; у document.get его нет (документация, живой отказ 2026-10-06):
  // готовность PDF там видна по ссылке и `isTransformationError`.
  if (o.isTransformationError === true || o.isTransformationError === 'Y') return { ok: false, reason: 'transformation error' }
  if (Number(o.entityTypeId) !== INVOICE_ENTITY_TYPE_ID || Number(o.entityId) !== invoiceId) return { ok: false, reason: `entity ${String(o.entityTypeId)}/${String(o.entityId)}` }
  const field = kind === 'image' ? 'imageUrlMachine' : 'pdfUrlMachine'
  const raw2 = o[field]
  if (typeof raw2 !== 'string' || !raw2) return { ok: false, reason: `no ${field}` }
  let u: URL
  try {
    u = new URL(raw2)
  } catch {
    return { ok: false, reason: `${field} not a URL` }
  }
  if (u.protocol !== 'https:' || u.hostname !== portalHost || u.username || u.password || u.port) {
    return { ok: false, reason: `${field} host ${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}, portal ${portalHost}` }
  }
  return { ok: true, url: u.toString(), title: plainText(o.title).slice(0, 200) }
}

/** Имя файла для Content-Disposition: только безопасные символы, расширение .pdf. */
export function pdfFileName(title: string, id: number): string {
  const base = title.replace(/[^\p{L}\p{N} ._-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
  return `${base || `document-${id}`}.pdf`
}

/** Тип файла по сигнатуре: PDF, PNG, JPEG; другое (JSON или HTML ошибки портала) — `null`. */
export function fileKindOf(bytes: Uint8Array): { type: 'application/pdf' | 'image/png' | 'image/jpeg', ext: string } | null {
  const b = bytes
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2D) return { type: 'application/pdf', ext: 'pdf' }
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { type: 'image/png', ext: 'png' }
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { type: 'image/jpeg', ext: 'jpg' }
  return null
}
