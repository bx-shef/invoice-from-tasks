// Задачи и записи затраченного времени: разбор ответов REST в доменные типы.
//
// ⚠ Портал отдаёт числа СТРОКАМИ, а регистр ключей зависит от метода (tasks.task.list —
// camelCase, task.elapseditem.getlist — UPPER_CASE). Поэтому каждое поле читается обоими
// способами (`pick`). Урок соседнего get-task-from-b24 (docs/REST_METHODS.md, «Задачи»): непонятый
// фильтр tasks.task.list портал НЕ отвергает, а отдаёт все задачи подряд — привязку к CRM мы
// перепроверяем сами (`hasCrmBinding`), а не верим фильтру.

import { portalDate } from './time'

/** CRM-тип счёта (новые счета). */
export const INVOICE_ENTITY_TYPE_ID = 31
/** CRM-тип сделки. */
export const DEAL_ENTITY_TYPE_ID = 2
/** Код типа счёта для товарных позиций (`ownerType`) — из документации crm.item.productrow.*. */
export const INVOICE_OWNER_TYPE = 'SI'

export interface TaskInfo {
  id: number
  title: string
  description: string
  responsibleId: number | null
  /** Привязки к CRM из UF_CRM_TASK: `D_12`, `SI_5`, … */
  crmBindings: string[]
  /** Затраченное время по журналу (секунды), как его считает портал. */
  timeSpentInLogs: number
}

export interface TimeEntry {
  id: number
  taskId: number
  userId: number | null
  seconds: number
  comment: string
  /** Дата работы (`YYYY-MM-DD`, пояс портала) — по ней выбирается ставка. */
  date: string | null
}

type Row = Record<string, unknown>

function pick(row: Row, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key]
  }
  return undefined
}

function toInt(value: unknown): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(toText).filter(Boolean)
  const single = toText(value)
  return single ? [single] : []
}

/** Строки ответа: голый массив или обёртка `{ tasks: [...] }` / `{ items: [...] }`. */
export function listRows(result: unknown, ...keys: string[]): Row[] {
  if (Array.isArray(result)) return result.filter((r): r is Row => !!r && typeof r === 'object')
  if (result && typeof result === 'object') {
    for (const key of keys) {
      const inner = (result as Row)[key]
      if (Array.isArray(inner)) return inner.filter((r): r is Row => !!r && typeof r === 'object')
    }
  }
  return []
}

/** Задача из ответа tasks.task.list / tasks.task.get (элемент массива `tasks`). */
export function parseTask(row: Row): TaskInfo | null {
  const id = toInt(pick(row, 'id', 'ID'))
  if (id === null) return null
  return {
    id,
    title: toText(pick(row, 'title', 'TITLE')).trim(),
    description: toText(pick(row, 'description', 'DESCRIPTION')),
    responsibleId: toInt(pick(row, 'responsibleId', 'RESPONSIBLE_ID')),
    crmBindings: toStringList(pick(row, 'ufCrmTask', 'UF_CRM_TASK')),
    timeSpentInLogs: Math.max(0, Number(pick(row, 'timeSpentInLogs', 'TIME_SPENT_IN_LOGS')) || 0)
  }
}

/** Запись затраченного времени из ответа task.elapseditem.getlist. */
export function parseTimeEntry(row: Row): TimeEntry | null {
  const id = toInt(pick(row, 'ID', 'id'))
  const taskId = toInt(pick(row, 'TASK_ID', 'taskId'))
  if (id === null || taskId === null) return null
  const seconds = Number(pick(row, 'SECONDS', 'seconds'))
  return {
    id,
    taskId,
    userId: toInt(pick(row, 'USER_ID', 'userId')),
    seconds: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0,
    comment: toText(pick(row, 'COMMENT_TEXT', 'commentText')).trim(),
    // ⚠ DATE_START — когда работа началась (ручная запись может быть задним числом);
    // CREATED_DATE — когда запись внесли. Ставка должна браться на день работы.
    date: portalDate(pick(row, 'DATE_START', 'dateStart')) ?? portalDate(pick(row, 'CREATED_DATE', 'createdDate'))
  }
}

/**
 * Коды привязки задачи к элементу CRM (значения UF_CRM_TASK).
 *
 * ⚠ Для сделки код `D_<id>` описан в документации. Для нового счёта код НЕ подтверждён ни
 * документацией, ни живым порталом: по аналогии с `ownerType = SI` у товарных позиций
 * ожидаем `SI_<id>`, но смарт-сущности в задачах кодируются и как `T<hex типа>_<id>`
 * (31 = 0x1f). Ищем по обоим и сверяем сами — лишний запрос дешевле пропущенных задач.
 * Замер на живом портале — follow-up issue.
 */
export function crmBindingCodes(entityTypeId: number, id: number): string[] {
  if (entityTypeId === DEAL_ENTITY_TYPE_ID) return [`D_${id}`]
  if (entityTypeId === INVOICE_ENTITY_TYPE_ID) return [`SI_${id}`, `T${entityTypeId.toString(16)}_${id}`]
  return [`T${entityTypeId.toString(16)}_${id}`]
}

/** Действительно ли задача привязана к элементу — сверка без учёта регистра (`T1F_5` = `T1f_5`). */
export function hasCrmBinding(task: TaskInfo, codes: string[]): boolean {
  const wanted = new Set(codes.map(c => c.toLowerCase()))
  return task.crmBindings.some(b => wanted.has(b.toLowerCase()))
}

/** Задачи из ответа списка, оставляя только действительно привязанные и без дублей. */
export function tasksBoundTo(rows: Row[], codes: string[]): TaskInfo[] {
  const byId = new Map<number, TaskInfo>()
  for (const row of rows) {
    const task = parseTask(row)
    if (task && hasCrmBinding(task, codes)) byId.set(task.id, task)
  }
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** Адрес задачи в портале для ссылок в ошибках и предпросмотре. */
export function taskUrl(domain: string, taskId: number): string {
  return `https://${domain}/company/personal/user/0/tasks/task/view/${taskId}/`
}
