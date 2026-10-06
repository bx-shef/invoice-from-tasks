// Поиск чатов для «чата проблем» правами сотрудника из фрейма (право `im`). Разбор — app/utils/chatOptions.ts.

import { CHAT_SEARCH_MIN, chatsFromRecent, chatsFromSearch, type ChatOption } from '~/utils/chatOptions'

export function useChats() {
  const b24 = useB24()

  /** Запрос короче 3 символов — недавние групповые чаты; иначе — поиск по названию. */
  async function search(query: string): Promise<ChatOption[]> {
    const q = query.trim()
    if (q.length >= CHAT_SEARCH_MIN) return chatsFromSearch(await b24.call<unknown>('im.search.chat.list', { FIND: q, LIMIT: 50 }))
    return chatsFromRecent(await b24.call<unknown>('im.recent.list', { SKIP_DIALOG: 'Y', LIMIT: 50 }))
  }

  return { search }
}
