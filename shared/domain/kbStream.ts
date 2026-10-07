// Поток ответа ИИ-чата справки (по образцу skills-site: сначала подобранные страницы, затем текст
// модели по мере генерации). Формат — NDJSON: одно событие JSON на строку. Общий для сервера
// (`server/api/kb/chat.post.ts`) и окна чата (`HelpChat.vue`).

/** Страница-источник ответа. */
export interface KbSource { title: string, url: string }

export type KbStreamEvent
  = | { type: 'sources', sources: KbSource[] }
    | { type: 'text', text: string }
    | { type: 'error', message: string }

export function encodeKbEvent(e: KbStreamEvent): string {
  return `${JSON.stringify(e)}\n`
}

function isEvent(v: unknown): v is KbStreamEvent {
  const e = v as Record<string, unknown> | null
  if (!e || typeof e !== 'object') return false
  if (e.type === 'text') return typeof e.text === 'string'
  if (e.type === 'error') return typeof e.message === 'string'
  if (e.type === 'sources') return Array.isArray(e.sources)
  return false
}

/**
 * Разборщик потока: кормим кусками текста как пришли из сети (строка события может порваться
 * между кусками), получаем готовые события. Непонятные строки пропускаем. `flush` — хвост в конце.
 */
export function kbStreamParser() {
  let buf = ''
  const parse = (line: string): KbStreamEvent[] => {
    if (!line.trim()) return []
    try {
      const v: unknown = JSON.parse(line)
      return isEvent(v) ? [v] : []
    } catch {
      return []
    }
  }
  return {
    push(chunk: string): KbStreamEvent[] {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      return lines.flatMap(parse)
    },
    flush(): KbStreamEvent[] {
      const rest = buf
      buf = ''
      return parse(rest)
    }
  }
}
