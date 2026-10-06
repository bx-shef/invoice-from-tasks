// Решение публичной страницы счёта (#34, этап 3) — чистый модуль с внедряемыми зависимостями.
// Порядок: лимиты → портал установлен → счёт → клиенты счёта → код (сравнение в постоянное время)
// → стадия из настроек → расшифровка. На любом «нет» до проверки кода ответ ОДИН и тот же —
// «неверный код или счёт» (404): перебором нельзя узнать, есть ли счёт и чей он.
// Портал читается токеном установщика — осознанное исключение из «права CRM не расширяем».

import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { isAccessCode } from '#shared/domain/appFieldTypes'
import {
  clientTaskIdFor,
  parsePublicClient,
  parsePublicInvoice,
  parsePublicTask,
  publicRows,
  rowTaskIds,
  stageName,
  type PublicClient,
  type PublicInvoiceView,
  type PublicTask
} from '#shared/domain/publicInvoice'
import { parseSettings, SETTINGS_KEY } from '#shared/domain/settings'
import { ACCESS_CODE_FIELD } from '#shared/domain/userFields'
import { V3_PREFIX, type RestCall } from './b24Client'
import { readOption } from './options'
import type { WindowLimit } from './rateLimit'

/** Попыток кода с одного IP — 10 за 10 минут; на один счёт — 20 в час (перебор с многих IP). */
export const PUBLIC_PER_IP: WindowLimit = { max: 10, windowMs: 10 * 60_000 }
export const PUBLIC_PER_INVOICE: WindowLimit = { max: 20, windowMs: 60 * 60_000 }
/** Сколько задач расшифровываем — у каждой два запроса в портал. */
export const MAX_PUBLIC_TASKS = 30
/** Сколько позиций счёта читаем (страница — 50). */
export const MAX_PUBLIC_ROWS = 200

export const NOT_FOUND = 'Неверный код или счёт не найден'

export type PublicResult
  = | { status: 200, body: { state: 'open', invoice: PublicInvoiceView } | { state: 'closed', text: string } }
    | { status: 400 | 404 | 429 | 503, body: { error: string } }

export interface PublicDeps {
  /** Портал по домену: memberId и REST токеном установщика; `null` — не установлен. */
  portal: (domain: string) => Promise<{ call: RestCall, origin: string } | null>
  /** Учесть попытку в лимитах; `false` — лимит исчерпан. */
  allow: (ipKey: string, invoiceKey: string) => boolean
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
  // Сравниваем со всеми, без раннего выхода: время ответа не зависит от того, чей код подошёл.
  let ok = false
  for (const c of clients) if (c.accessCode && codeEquals(code, c.accessCode)) ok = true
  return ok
}

async function rows(call: RestCall, invoiceId: number): Promise<unknown[]> {
  const out: unknown[] = []
  for (let start = 0; start < MAX_PUBLIC_ROWS; start += 50) {
    const res = await call('crm.item.productrow.list', { filter: { '=ownerType': 'SI', '=ownerId': invoiceId }, order: { id: 'asc' }, start }) as { productRows?: unknown[] } | null
    const page = Array.isArray(res?.productRows) ? res.productRows : []
    out.push(...page)
    if (page.length < 50) break
  }
  return out
}

export async function loadPublicInvoice(req: PublicRequest, deps: PublicDeps): Promise<PublicResult> {
  if (!Number.isInteger(req.invoiceId) || req.invoiceId <= 0 || !req.domain) return { status: 400, body: { error: 'Неверная ссылка' } }
  if (!isAccessCode(req.code)) return { status: 404, body: { error: NOT_FOUND } }
  if (!deps.allow(`pub-ip:${req.ip}`, `pub-inv:${req.domain}:${req.invoiceId}`)) {
    return { status: 429, body: { error: 'Слишком много попыток — попробуйте позже' } }
  }
  const portal = await deps.portal(req.domain)
  if (!portal) return { status: 404, body: { error: NOT_FOUND } }
  const { call } = portal

  const invoice = parsePublicInvoice(await call('crm.item.get', { entityTypeId: 31, id: req.invoiceId }).catch(() => null))
  if (!invoice) return { status: 404, body: { error: NOT_FOUND } }

  const settings = parseSettings(await readOption(call, SETTINGS_KEY))
  const { companyDomain, contactDomain, task: clientTaskField } = settings.clientFields
  const clients: PublicClient[] = []
  if (invoice.companyId) {
    const c = parsePublicClient('company', await call('crm.item.get', { entityTypeId: 4, id: invoice.companyId }).catch(() => null), ACCESS_CODE_FIELD, companyDomain)
    if (c) clients.push(c)
  }
  for (const id of invoice.contactIds) {
    const c = parsePublicClient('contact', await call('crm.item.get', { entityTypeId: 3, id }).catch(() => null), ACCESS_CODE_FIELD, contactDomain)
    if (c) clients.push(c)
  }
  if (!matchesClient(req.code, clients)) return { status: 404, body: { error: NOT_FOUND } }

  // Код верный — только теперь говорим о стадии: иначе по ответу узнавали бы, есть ли счёт.
  if (!settings.publicPage.stages.includes(invoice.stageId)) {
    return { status: 200, body: { state: 'closed', text: settings.publicPage.closedText } }
  }

  const [stages, myCompany, rawRows] = await Promise.all([
    call('crm.status.list', { filter: { STATUS_ID: invoice.stageId } }).catch(() => []),
    invoice.myCompanyId ? call('crm.item.get', { entityTypeId: 4, id: invoice.myCompanyId }).catch(() => null) : Promise.resolve(null),
    rows(call, invoice.id)
  ])
  const list = publicRows(rawRows)
  const clientDomain = clients.find(c => c.kind === 'company' && c.domain)?.domain ?? clients.find(c => c.domain)?.domain ?? null
  const tasks: PublicTask[] = []
  for (const taskId of rowTaskIds(list, MAX_PUBLIC_TASKS)) {
    const select = ['ID', 'TITLE', 'DESCRIPTION', ...(clientTaskField ? [clientTaskField] : [])]
    const raw = await call('tasks.task.get', { taskId, select }).catch(() => null)
    if (!raw) continue
    const results = await call(`${V3_PREFIX}tasks.task.result.list`, { filter: [['taskId', '=', taskId]], select: ['id', 'text'], order: { id: 'desc' }, pagination: { limit: 20 } }).catch(() => [])
    const task = parsePublicTask(raw, portal.origin, clientTaskIdFor(list, taskId, raw, clientTaskField), clientDomain, Array.isArray(results) ? results : (results as { items?: unknown } | null)?.items)
    if (task) tasks.push(task)
  }
  const myCompanyItem = parsePublicClient('company', myCompany, ACCESS_CODE_FIELD, '')
  return {
    status: 200,
    body: {
      state: 'open',
      invoice: {
        title: invoice.title,
        date: invoice.date,
        stage: stageName(stages, invoice.stageId),
        currencyId: invoice.currencyId,
        total: invoice.opportunity,
        company: clients.find(c => c.kind === 'company')?.title || null,
        contacts: clients.filter(c => c.kind === 'contact').map(c => c.title).filter(Boolean),
        myCompany: myCompanyItem?.title || null,
        rows: list,
        tasks
      }
    }
  }
}
