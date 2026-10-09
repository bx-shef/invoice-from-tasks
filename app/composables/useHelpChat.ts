// Состояние ИИ-чата справки, общее для поиска, кнопки «Спросить ИИ», «Обсудить с ИИ» и панели
// чата (как useHdChat в toolsai). `ask` — вопрос, который панель отправит сразу после открытия;
// `topic` — обсуждаемая страница: её slug уходит на сервер, и её фрагменты идут в контекст первыми.
import { discussQuestion } from '~/utils/helpLayout'

export interface HelpTurn {
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{ title: string, url: string }>
}

export function useHelpChat() {
  const open = useState('help-chat-open', () => false)
  const ask = useState('help-chat-ask', () => '')
  const topic = useState<{ slug: string, title: string } | null>('help-chat-topic', () => null)
  const turns = useState<HelpTurn[]>('help-chat-turns', () => [])

  function openChat(question?: string) {
    if (question?.trim()) ask.value = question.trim()
    open.value = true
  }
  function closeChat() {
    open.value = false
  }
  function discussPage(slug: string, title: string) {
    topic.value = { slug, title }
    openChat(discussQuestion(title))
  }

  return { open, ask, topic, turns, openChat, closeChat, discussPage }
}
