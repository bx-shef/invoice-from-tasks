// Чтения сценария счёта — те же запросы (app/utils/invoiceRequests.ts), то же листание
// (app/utils/paging.ts) и тот же разбор (shared/domain), что у страницы (useInvoiceFill.ts),
// только поверх вебхука вместо фрейма.

import { crmBindingCodes, DEAL_ENTITY_TYPE_ID, INVOICE_ENTITY_TYPE_ID, listRows, parseTimeEntry, tasksBoundTo, type TaskInfo, type TimeEntry } from '#shared/domain/tasks'
import { parseExistingRows, parseInvoice, type ExistingRow, type InvoiceInfo } from '#shared/domain/invoice'
import type { TaskSource } from '#shared/domain/fill'
import {
  elapsedListCall,
  ELAPSED_PAGE,
  invoiceGetCall,
  MAX_ELAPSED_PAGES,
  MAX_PRODUCT_ROWS,
  productRowListCall,
  PRODUCT_ROWS_PAGE,
  TASK_LIST_OPTIONS,
  taskListCall
} from '~/utils/invoiceRequests'
import { collectNumberedPages, collectOffsetPages } from '~/utils/paging'
import type { Portal } from './portal'

export async function readInvoice(portal: Portal, id: number): Promise<{ invoice: InvoiceInfo, rows: ExistingRow[] }> {
  const get = invoiceGetCall(id)
  const invoice = parseInvoice(await portal.call(get.method, get.params))
  if (!invoice) throw new Error(`счёт ${id} не прочитан`)
  const raw = await collectOffsetPages(async (start) => {
    const { method, params } = productRowListCall(id, start)
    return (await portal.call<{ productRows?: unknown[] }>(method, params))?.productRows ?? []
  }, PRODUCT_ROWS_PAGE, MAX_PRODUCT_ROWS, 'слишком много позиций')
  return { invoice, rows: parseExistingRows(raw) }
}

export async function fetchTasks(portal: Portal, source: TaskSource, invoice: InvoiceInfo): Promise<TaskInfo[]> {
  const codes = source === 'deal' ? crmBindingCodes(DEAL_ENTITY_TYPE_ID, invoice.dealId!) : crmBindingCodes(INVOICE_ENTITY_TYPE_ID, invoice.id)
  const rows: Record<string, unknown>[] = []
  for (const code of codes) {
    const { method, params } = taskListCall(code)
    rows.push(...await portal.callList<Record<string, unknown>>(method, params, { ...TASK_LIST_OPTIONS }))
  }
  return tasksBoundTo(rows, codes)
}

/** Записи времени задачи и сколько запросов ушло на листание. */
export async function fetchEntries(portal: Portal, taskId: number): Promise<{ entries: TimeEntry[], calls: number }> {
  let calls = 0
  const raw = await collectNumberedPages(async (page) => {
    calls++
    const { method, params } = elapsedListCall(taskId, page)
    return { rows: listRows(await portal.call(method, params)) }
  }, ELAPSED_PAGE, MAX_ELAPSED_PAGES, 'слишком много записей', row => (row as { ID?: unknown }).ID)
  const byId = new Map<number, TimeEntry>()
  for (const row of raw) {
    const entry = parseTimeEntry(row)
    if (entry) byId.set(entry.id, entry)
  }
  return { entries: [...byId.values()], calls }
}
