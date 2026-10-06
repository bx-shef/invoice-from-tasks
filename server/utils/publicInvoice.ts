// Решение публичной страницы счёта (#34, этап 3) — чистый модуль с внедряемыми зависимостями.
// Порядок: домен → лимиты → портал установлен → счёт и клиенты (2 запроса) → код (сравнение в
// постоянное время) → настройки и стадия → расшифровка (кеш на 2 минуты).
// На любом «нет» до проверки кода ответ ОДИН и тот же — «неверный код или счёт» (404), а его время
// выравнивает обработчик (PUBLIC_404_FLOOR_MS): ни текстом, ни задержкой нельзя узнать, есть ли счёт.
// Портал читается токеном установщика — осознанное исключение из «права CRM не расширяем».

import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { isAccessCode, parseHookValue } from '#shared/domain/appFieldTypes'
import {
  batchCommand,
  clientTaskIdFor,
  documentEntries,
  documentPdfCheck,
  fileKindOf,
  type DocumentKind,
  latestDocuments,
  pdfFileName,
  invoiceBindingCodes,
  parsePublicClient,
  parsePublicInvoice,
  parsePublicTask,
  publicRows,
  rowTaskIds,
  stageName,
  taskBoundTo,
  type ClientTaskView,
  type PublicClient,
  type PublicInvoiceItem,
  type PublicInvoiceView,
  type PublicTask
} from '#shared/domain/publicInvoice'
import { parseSettings, SETTINGS_KEY, type AppSettings } from '#shared/domain/settings'
import { ACCESS_CODE_FIELD } from '#shared/domain/userFields'
import { V3_PREFIX, type RestCall } from './b24Client'
import { readOption } from './options'
import type { WindowLimit } from './rateLimit'

/** Попыток с одного IP — 10 за 10 минут (все попытки). */
export const PUBLIC_PER_IP: WindowLimit = { max: 10, windowMs: 10 * 60_000 }
/** Попыток на портал — 600 в час: распределённый перебор не съест REST-лимит портала. */
export const PUBLIC_PER_PORTAL: WindowLimit = { max: 600, windowMs: 60 * 60_000 }
/**
 * НЕВЕРНЫХ кодов на счёт — 100 в час. Считаются только ошибки: верный код счётчик не тратит. Код —
 * ~58 бит, перебор этим лимитом всё равно безнадёжен; а посторонний, у которого есть ссылка с
 * бумажного счёта, заблокирует клиента не 20 случайными кодами, а только сотней (компромисс в
 * docs/ARCHITECTURE.md).
 */
export const PUBLIC_FAILS_PER_INVOICE: WindowLimit = { max: 100, windowMs: 60 * 60_000 }
/** Минимальное время ответа «неверный код или счёт»: не различить «нет портала» и «не тот код». */
export const PUBLIC_404_FLOOR_MS = 800
/** Сколько контактов счёта проверяем — один пакет `batch` (предел 50 команд). */
export const MAX_PUBLIC_CONTACTS = 20
/** Сколько задач расшифровываем — один пакет на задачи и по запросу результатов на каждую. */
export const MAX_PUBLIC_TASKS = 20
/** Сколько позиций счёта читаем (страница — 50). */
export const MAX_PUBLIC_ROWS = 200
/** Сколько живёт готовая расшифровка: повторные открытия не гоняют портал. Код проверяется всегда. */
export const PUBLIC_CACHE_MS = 2 * 60_000

export const NOT_FOUND = 'Неверный код или счёт не найден'

/** Домен из адреса: только символы имени хоста — иначе 400, и он не попадает ни в ключи лимитов, ни в журнал. */
const DOMAIN_RE = /^[a-z0-9.-]{3,253}$/

export type PublicBody = { state: 'open', invoice: PublicInvoiceView } | { state: 'closed', text: string }

export type PublicResult
  = | { status: 200, body: PublicBody }
    | { status: 400 | 404 | 429, body: { error: string } }

export interface PublicDeps {
  /** Портал по домену: REST токеном установщика и адрес; `null` — не установлен или не Битрикс24. */
  portal: (domain: string) => Promise<{ call: RestCall, origin: string } | null>
  /** Учесть попытку в лимитах IP и портала; `false` — исчерпано. */
  allowAttempt: (ipKey: string, portalKey: string) => boolean
  /** Исчерпан ли лимит неверных кодов счёта (без учёта попытки). */
  locked: (invoiceKey: string) => boolean
  /** Учесть неверный код счёта. */
  fail: (invoiceKey: string) => void
  cache: { get: (key: string) => PublicInvoiceView | undefined, set: (key: string, view: PublicInvoiceView) => void }
  /**
   * Задачи клиента его вебхуком (этап 4): значение поля «Вебхук клиента» → расшифровка и чтение.
   * `null` — вебхук не открылся (чужой портал, ключ, домен вне списка). Не задано — этап выключен.
   */
  clientTasks?: (hookValue: string, portalDomain: string, ids: number[]) => Promise<{ host: string, tasks: Map<number, ClientTaskView> } | null>
}

export interface PublicRequest {
  domain: string
  invoiceId: number
  code: string
  ip: string
}

/** Сравнение кода в постоянное время: перебор не узнает по задержке, сколько символов совпало. */
export function codeEquals(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Подходит ли код хоть одному клиенту счёта (компании или любому контакту — решение владельца). */
export function matchesClient(code: string, clients: PublicClient[]): boolean {
  // Со всеми, без раннего выхода: время ответа не зависит от того, чей код подошёл.
  let ok = false
  for (const c of clients) if (c.accessCode && codeEquals(code, c.accessCode)) ok = true
  return ok
}

/**
 * «Не найдено» или «нет доступа» — это ответ клиенту «неверный код или счёт»; всё остальное (сеть,
 * токен, лимит портала) — сбой, его обработчик отдаёт 503: иначе клиент с верным кодом при сбое
 * портала тратил бы попытки на «неверный код» (находка /code-review).
 */
export function isNotFound(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e)
  return /NOT_FOUND|not found|не найден|ACCESS_DENIED|access denied/i.test(m)
}

async function orNull(p: Promise<unknown>): Promise<unknown> {
  try {
    return await p
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
}

/** Пакет `batch` (REST v2): ответы по ключам; ошибка отдельной команды — нет ключа. */
export async function batch(call: RestCall, cmd: Record<string, string>): Promise<Record<string, unknown>> {
  if (!Object.keys(cmd).length) return {}
  const res = await call('batch', { halt: 0, cmd }) as { result?: Record<string, unknown> } | null
  return res?.result && typeof res.result === 'object' ? res.result : {}
}

async function readRows(call: RestCall, invoiceId: number): Promise<{ rows: unknown[], truncated: boolean }> {
  const out: unknown[] = []
  for (let start = 0; start < MAX_PUBLIC_ROWS; start += 50) {
    const res = await call('crm.item.productrow.list', { filter: { '=ownerType': 'SI', '=ownerId': invoiceId }, order: { id: 'asc' }, start }) as { productRows?: unknown[] } | null
    const page = Array.isArray(res?.productRows) ? res.productRows : []
    out.push(...page)
    if (page.length < 50) return { rows: out, truncated: false }
  }
  return { rows: out, truncated: true }
}

/**
 * Задачи клиента (этап 4): вебхуки — из полей компании и контактов счёта, задача ищется по
 * номеру и домену из своей задачи (`clientTaskUrl`) — вебхук берётся только того портала, чей
 * домен указан в задаче. Сбой портала клиента не роняет страницу: остаётся ссылка.
 */
export async function attachClientTasks(tasks: PublicTask[], clients: PublicClient[], portalDomain: string, deps: Pick<PublicDeps, 'clientTasks'>): Promise<void> {
  if (!deps.clientTasks) return
  const wanted = new Map<string, number[]>()
  for (const t of tasks) {
    if (!t.clientTaskUrl || !t.clientTaskId || !/^\d+$/.test(t.clientTaskId)) continue
    const host = new URL(t.clientTaskUrl).hostname
    wanted.set(host, [...(wanted.get(host) ?? []), Number(t.clientTaskId)])
  }
  if (!wanted.size) return
  // Один портал — одна попытка: у компании и контактов вебхуки одного портала разные (свой IV),
  // и при упавшем портале каждый ждал бы дедлайн заново (находка /code-review).
  const done = new Set<string>()
  for (const hook of new Set(clients.map(c => c.hook).filter((v): v is string => !!v))) {
    const host = parseHookValue(hook)?.host ?? ''
    const ids = wanted.get(host)
    if (!ids || done.has(host)) continue
    done.add(host)
    const got = await deps.clientTasks(hook, portalDomain, ids).catch((e: unknown) => {
      console.warn(`[public] client portal ${host}: ${e instanceof Error ? e.message : String(e)}`)
      return null
    })
    if (!got || got.host !== host) continue
    for (const t of tasks) {
      if (t.clientTaskUrl && new URL(t.clientTaskUrl).hostname === host) t.clientTask = got.tasks.get(Number(t.clientTaskId)) ?? null
    }
  }
}

/** Доступ подтверждён: портал, счёт, клиенты и настройки — для страницы и скачивания документа. */
export interface PublicAccess {
  call: RestCall
  origin: string
  invoice: PublicInvoiceItem
  clients: PublicClient[]
  settings: AppSettings
}

/**
 * Проверка доступа — общая для страницы и скачивания PDF (этап 5): ссылка → лимиты → портал →
 * счёт и клиенты (2 запроса) → код → настройки → стадия. Не подтверждён — готовый ответ: 400, 404
 * (неверный код учтён), 429 или «закрыто» со фразой из настроек.
 */
export async function verifyPublicAccess(req: PublicRequest, deps: PublicDeps): Promise<PublicAccess | PublicResult> {
  if (!Number.isInteger(req.invoiceId) || req.invoiceId <= 0 || !DOMAIN_RE.test(req.domain)) return { status: 400, body: { error: 'Неверная ссылка' } }
  if (!isAccessCode(req.code)) return { status: 404, body: { error: NOT_FOUND } }
  const invoiceKey = `pub-inv:${req.domain}:${req.invoiceId}`
  if (!deps.allowAttempt(`pub-ip:${req.ip}`, `pub-portal:${req.domain}`) || deps.locked(invoiceKey)) {
    return { status: 429, body: { error: 'Слишком много попыток — попробуйте позже' } }
  }
  const notFound = (): PublicResult => {
    deps.fail(invoiceKey)
    return { status: 404, body: { error: NOT_FOUND } }
  }
  const portal = await deps.portal(req.domain)
  if (!portal) return notFound()
  const { call } = portal

  // До кода — два запроса: счёт и один пакет клиентов. Настройки — после (они нужны только дальше).
  const invoice = parsePublicInvoice(await orNull(call('crm.item.get', { entityTypeId: 31, id: req.invoiceId })))
  if (!invoice) return notFound()
  const cmd: Record<string, string> = {}
  if (invoice.companyId) cmd.company = batchCommand('crm.item.get', { entityTypeId: 4, id: invoice.companyId })
  for (const [i, id] of invoice.contactIds.slice(0, MAX_PUBLIC_CONTACTS).entries()) {
    cmd[`contact${i}`] = batchCommand('crm.item.get', { entityTypeId: 3, id })
  }
  const got = await batch(call, cmd)
  const clients = Object.entries(got)
    .map(([key, value]) => parsePublicClient(key === 'company' ? 'company' : 'contact', value, ACCESS_CODE_FIELD))
    .filter((c): c is PublicClient => c !== null)
  if (!matchesClient(req.code, clients)) return notFound()

  // Код верный — только теперь говорим о стадии: иначе по ответу узнавали бы, есть ли счёт.
  const settings = parseSettings(await readOption(call, SETTINGS_KEY))
  if (!settings.publicPage.stages.includes(invoice.stageId)) {
    return { status: 200, body: { state: 'closed', text: settings.publicPage.closedText } }
  }
  return { call, origin: portal.origin, invoice, clients, settings }
}

function isResult(v: PublicAccess | PublicResult): v is PublicResult {
  return 'status' in v
}

export async function loadPublicInvoice(req: PublicRequest, deps: PublicDeps): Promise<PublicResult> {
  const access = await verifyPublicAccess(req, deps)
  if (isResult(access)) return access
  const { call, invoice, clients, settings } = access
  const portal = { origin: access.origin }
  const cacheKey = `${req.domain}:${invoice.id}`
  const cached = deps.cache.get(cacheKey)
  if (cached) return { status: 200, body: { state: 'open', invoice: cached } }

  const { task: clientTaskField, taskDomain } = settings.clientFields

  // Документы — параллельно со стадией и строками; их сбой страницу не роняет (блок необязательный).
  const documentsPromise = readLatestDocuments(call, settings.publicPage.templates, invoice.id)
  const [stages, myCompany, rowsRead] = await Promise.all([
    orNull(call('crm.status.list', { filter: { STATUS_ID: invoice.stageId } })),
    invoice.myCompanyId ? orNull(call('crm.item.get', { entityTypeId: 4, id: invoice.myCompanyId })) : Promise.resolve(null),
    readRows(call, invoice.id)
  ])
  const list = publicRows(rowsRead.rows)

  // Задачи — одним пакетом; показываем только привязанные к этому счёту или его сделке.
  const codes = invoiceBindingCodes(invoice)
  const select = ['ID', 'TITLE', 'DESCRIPTION', 'UF_CRM_TASK', ...[clientTaskField, taskDomain].filter(Boolean)]
  const ids = rowTaskIds(list, MAX_PUBLIC_TASKS)
  const taskRaw = await batch(call, Object.fromEntries(ids.map(id => [`t${id}`, batchCommand('tasks.task.get', { taskId: id, select })])))
  const tasks: PublicTask[] = []
  for (const id of ids) {
    const rawTask = taskRaw[`t${id}`]
    if (!rawTask || !taskBoundTo(rawTask, codes)) continue
    // Результаты — только в REST v3 (пакета v3 у SDK сервера нет): по запросу на задачу.
    const results = await orNull(call(`${V3_PREFIX}tasks.task.result.list`, { filter: [['taskId', '=', id]], select: ['id', 'text'], order: { id: 'desc' }, pagination: { limit: 20 } }))
    const resultList = Array.isArray(results) ? results : (results as { items?: unknown } | null)?.items
    const task = parsePublicTask(rawTask, portal.origin, clientTaskIdFor(list, id, rawTask, clientTaskField), resultList, taskDomain)
    if (task) tasks.push(task)
  }
  await attachClientTasks(tasks, clients, req.domain, deps)
  const documents = await documentsPromise
  const view: PublicInvoiceView = {
    truncated: rowsRead.truncated,
    title: invoice.title,
    date: invoice.date,
    stage: stageName(stages, invoice.stageId),
    currencyId: invoice.currencyId,
    total: invoice.opportunity,
    company: clients.find(c => c.kind === 'company')?.title || null,
    contacts: clients.filter(c => c.kind === 'contact').map(c => c.title).filter(Boolean),
    myCompany: parsePublicClient('company', myCompany, ACCESS_CODE_FIELD)?.title || null,
    rows: list,
    tasks,
    documents
  }
  deps.cache.set(cacheKey, view)
  return { status: 200, body: { state: 'open', invoice: view } }
}

/** Документы счёта (этап 5): новые первыми, фильтр по счёту — `entityTypeId` + `entityId` (документация метода). */
export function documentListParams(invoiceId: number): Record<string, unknown> {
  return {
    select: ['id', 'title', 'templateId', 'pdfId', 'entityTypeId', 'entityId'],
    filter: { entityTypeId: 31, entityId: invoiceId },
    order: { id: 'desc' }
  }
}

/** Последние документы счёта по шаблонам; сбой портала — пусто и строка в журнале. */
export async function readLatestDocuments(call: RestCall, templates: number[], invoiceId: number) {
  if (!templates.length) return []
  try {
    return latestDocuments(await call('crm.documentgenerator.document.list', documentListParams(invoiceId)), templates, invoiceId)
  } catch (e) {
    console.warn(`[public] documents of invoice ${invoiceId}: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

/** Предел PDF, байт — документ счёта больше не бывает, а память сервера не резиновая. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024

export type DocumentResult
  = | { status: 200, pdf: Uint8Array, fileName: string, contentType: string }
    | PublicResult

export interface DocumentDeps extends PublicDeps {
  /** Скачать PDF по машинной ссылке портала (https, без редиректов, предел размера). */
  fetchPdf: (url: string) => Promise<Uint8Array>
}

/**
 * Скачивание PDF документа (этап 5): та же проверка доступа, что у страницы (код, стадия), затем
 * документ — только этого счёта и разрешённого шаблона, машинная ссылка — только на сам портал.
 * Ссылка (в ней токен) наружу не уходит: клиент получает файл, а не адрес.
 */
export async function loadPublicDocument(req: PublicRequest & { documentId: number, kind?: DocumentKind }, deps: DocumentDeps): Promise<DocumentResult> {
  const kind: DocumentKind = req.kind === 'image' ? 'image' : 'pdf'
  if (!Number.isInteger(req.documentId) || req.documentId <= 0) return { status: 400, body: { error: 'Неверная ссылка' } }
  const access = await verifyPublicAccess(req, deps)
  if (isResult(access)) return access.status === 200 ? { status: 404, body: { error: 'Документ недоступен' } } : access
  const { call, invoice, settings } = access
  // Скачать можно только то, что показано на странице: последний документ по шаблону, а не любую
  // старую версию перебором ID (находка ревью).
  const shown = await readLatestDocuments(call, settings.publicPage.templates, invoice.id)
  if (!shown.some(d => d.id === req.documentId)) return { status: 404, body: { error: 'Документ недоступен' } }
  // Машинная ссылка — из списка (`select: ['*']` отдаёт `pdfUrlMachine`, документация), иначе —
  // из document.get. Отказ проверки — в журнал с причиной (без ссылки: в ней токен).
  const host = new URL(access.origin).hostname
  const templates = settings.publicPage.templates
  const listed = documentEntries(await orNull(call('crm.documentgenerator.document.list', { ...documentListParams(invoice.id), select: ['*'] })))
    .find(d => Number(d.id) === req.documentId)
  let check = documentPdfCheck(listed ?? null, templates, invoice.id, host, kind)
  if (!check.ok) {
    const fromGet = documentPdfCheck(await orNull(call('crm.documentgenerator.document.get', { id: req.documentId })), templates, invoice.id, host, kind)
    if (!fromGet.ok) console.warn(`[public] document ${req.documentId} of invoice ${invoice.id}: list — ${check.reason}; get — ${fromGet.reason}`)
    check = fromGet
  }
  if (!check.ok) return { status: 404, body: { error: 'Документ недоступен' } }
  const doc = check
  const pdf = await deps.fetchPdf(doc.url)
  // Сигнатура: портал при ошибке отдаёт JSON или HTML — клиенту такой «PDF» не нужен. PDF — только
  // PDF, превью — только PNG или JPEG.
  const file = fileKindOf(pdf)
  if (!file || (kind === 'pdf') !== (file.type === 'application/pdf')) throw new Error(`document ${kind} has unexpected content`)
  return { status: 200, pdf, contentType: file.type, fileName: pdfFileName(doc.title, req.documentId).replace(/\.pdf$/, `.${file.ext}`) }
}
