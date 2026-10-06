// Чаты для выбора «чата проблем» (настройки → «Публичная страница»): разбор im.recent.list и
// im.search.chat.list — как в client-bank-alfa-by (server/utils/chatSearch.ts). Только групповые
// чаты, куда можно писать; значение — DIALOG_ID `chat<ID>`.

export interface ChatOption {
  value: string
  label: string
}

/** Поиск включается с 3 символов (требование im.search.chat.list). */
export const CHAT_SEARCH_MIN = 3

function dialogId(id: unknown): string | null {
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? `chat${n}` : null
}

/** Ответ im.search.chat.list (массив чатов): без чатов с запретом записи (`restrictions.send === false`). */
export function chatsFromSearch(result: unknown): ChatOption[] {
  const out: ChatOption[] = []
  for (const row of Array.isArray(result) ? result : []) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    if ((o.restrictions as { send?: unknown } | undefined)?.send === false) continue
    const value = dialogId(o.id)
    const label = String(o.name ?? '').trim()
    if (value && label) out.push({ value, label })
  }
  return out
}

/** Ответ im.recent.list (`{ items }`): без личных диалогов. */
export function chatsFromRecent(result: unknown): ChatOption[] {
  const items = (result as { items?: unknown } | null)?.items
  const out: ChatOption[] = []
  for (const row of Array.isArray(items) ? items : []) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    if (o.type === 'user') continue
    const value = dialogId(o.chat_id ?? o.id)
    const label = String(o.title ?? '').trim()
    if (value && label) out.push({ value, label })
  }
  return out
}
