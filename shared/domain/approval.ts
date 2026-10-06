// Режим согласования счёта (просьба владельца): в одной стадии счёта клиент на публичной странице
// пишет комментарии. Комментарий — универсальное дело (todo) в таймлайне счёта на ответственного со
// сроком +1 час; ответ клиенту — заметка к делу; закрытое дело показывается с отметкой.
// Чистые правила: сборка дела, разбор списка дел и заметок, проверки текста.

/** Приставка названия дела — по ней из дел счёта отбираются комментарии клиента. */
export const COMMENT_TITLE_PREFIX = 'Комментарий клиента'
/** Предел текста комментария, символов. */
export const MAX_COMMENT_LENGTH = 2000
/** Срок дела — через час после комментария (просьба владельца). */
export const COMMENT_DEADLINE_MS = 60 * 60_000
/** Сколько последних комментариев показываем клиенту (у каждого — запрос заметки в пакете). */
export const MAX_SHOWN_COMMENTS = 20

/**
 * Текст от клиента: без управляющих символов (кроме перевода строки), без пробелов по краям, не
 * длиннее предела; BB-коды таймлайна обезврежены — квадратные скобки заменены на похожие. Пусто — `null`.
 */
export function cleanComment(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // eslint-disable-next-line no-control-regex -- вырезаем именно управляющие символы
  const text = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\[/g, '⟦').replace(/\]/g, '⟧').trim()
  if (!text || text.length > MAX_COMMENT_LENGTH) return null
  return text
}

/** Параметры crm.activity.todo.add: дело на ответственного за счёт, срок — `now` + 1 час. */
export function commentTodoParams(invoiceId: number, responsibleId: number | null, author: string, text: string, now: Date): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ownerTypeId: 31,
    ownerId: invoiceId,
    deadline: new Date(now.getTime() + COMMENT_DEADLINE_MS).toISOString(),
    title: author ? `${COMMENT_TITLE_PREFIX}: ${author}` : COMMENT_TITLE_PREFIX,
    description: text,
    pingOffsets: [0]
  }
  if (responsibleId) params.responsibleId = responsibleId
  return params
}

/** Параметры crm.activity.list: дела-todo счёта, новые первыми (отбор по приставке — commentsFrom). */
export function commentListParams(invoiceId: number): Record<string, unknown> {
  return {
    filter: { OWNER_TYPE_ID: 31, OWNER_ID: invoiceId, PROVIDER_ID: 'CRM_TODO' },
    select: ['ID', 'SUBJECT', 'DESCRIPTION', 'CREATED', 'COMPLETED'],
    order: { ID: 'DESC' }
  }
}

export interface ApprovalComment {
  id: number
  /** Когда написан, ISO. */
  created: string
  text: string
  /** Дело закрыто ответственным. */
  closed: boolean
  /** Ответ клиенту — заметка к делу; нет — `null`. */
  answer: string | null
}

/** Комментарии клиента из списка дел счёта: только дела с нашей приставкой, не больше `max`. */
export function commentsFrom(raw: unknown, max = MAX_SHOWN_COMMENTS): ApprovalComment[] {
  const list = Array.isArray(raw) ? raw : []
  const out: ApprovalComment[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = Number(o.ID)
    if (!Number.isInteger(id) || id <= 0) continue
    if (typeof o.SUBJECT !== 'string' || !o.SUBJECT.startsWith(COMMENT_TITLE_PREFIX)) continue
    out.push({
      id,
      created: typeof o.CREATED === 'string' ? o.CREATED : '',
      text: typeof o.DESCRIPTION === 'string' ? o.DESCRIPTION : '',
      closed: o.COMPLETED === 'Y',
      answer: null
    })
    if (out.length >= max) break
  }
  return out
}

/** Текст заметки из ответа crm.timeline.note.get (`{ text }`); пусто — `null`. */
export function noteText(raw: unknown): string | null {
  const text = raw && typeof raw === 'object' ? (raw as { text?: unknown }).text : null
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

/** Название дела «счёт согласован» — для ответственного (в список комментариев оно не попадает). */
export const APPROVED_TITLE = 'Счёт согласован клиентом'

/** Отметка согласования в счёте: галка и момент. Ничего не выбрано в настройках — кнопки нет. */
export interface ApprovalMark {
  /** Можно ли согласовать со страницы: выбрано хотя бы одно поле. */
  enabled: boolean
  /** Уже согласовано (галка стоит или дата есть). */
  approved: boolean
  /** Момент согласования из поля даты, как отдал портал; нет — `null`. */
  approvedAt: string | null
}

function isYes(v: unknown): boolean {
  return v === true || v === 1 || v === 'Y' || v === '1' || v === 'true'
}

/**
 * Отметка из счёта (ответ crm.item.get, UF — в camelCase) по полям из настроек.
 *
 * @param keyOf код поля → ключ в ответе (camelFieldKey)
 */
export function approvalMark(item: Record<string, unknown>, fields: { approvedField: string, approvedAtField: string }, keyOf: (name: string) => string): ApprovalMark {
  const flag = fields.approvedField ? isYes(item[keyOf(fields.approvedField)]) : false
  const at = fields.approvedAtField ? item[keyOf(fields.approvedAtField)] : null
  const approvedAt = typeof at === 'string' && at.trim() ? at.trim() : null
  return { enabled: !!(fields.approvedField || fields.approvedAtField), approved: flag || approvedAt !== null, approvedAt }
}

/** Что записать в счёт по кнопке «Согласовать»: галка `Y` и момент (ISO). */
export function approvalUpdates(fields: { approvedField: string, approvedAtField: string }, keyOf: (name: string) => string, now: Date): Record<string, string> {
  const out: Record<string, string> = {}
  if (fields.approvedField) out[keyOf(fields.approvedField)] = 'Y'
  if (fields.approvedAtField) out[keyOf(fields.approvedAtField)] = now.toISOString()
  return out
}
