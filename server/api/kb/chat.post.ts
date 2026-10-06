// POST /api/kb/chat — ИИ-чат справки (по принципу toolsai): `{ messages, page? }` → ответ BitrixGPT
// по фрагментам публичной справки и список страниц-источников. Только из фрейма портала (модель
// платная) и в общих AI-лимитах сотрудника. Вопросы и ответы в журнал не пишем.

import { kbSources, kbSystemPrompt, parseKbMessages, selectChunks } from '#shared/domain/kb'
import { askBitrixGpt, enforceAiLimit } from '../../utils/aiGateway'
import { aiHttpError, loadKb, requireFrameUser } from '../../utils/requestContext'

export default defineEventHandler(async (event) => {
  const { user } = await requireFrameUser(event)
  const body = await readBody<{ messages?: unknown, page?: unknown } | null>(event)
  const messages = parseKbMessages(body?.messages)
  if (!messages) throw createError({ statusCode: 400, statusMessage: 'Пустой вопрос' })
  const { pages, index } = await loadKb()
  const page = typeof body?.page === 'string' && pages.some(p => p.slug === body.page) ? body.page : undefined
  const question = messages[messages.length - 1]!.content
  const chosen = selectChunks(index, question, page)
  console.info(`[kb] фрагментов: ${index.docs.length}, выбрано: ${chosen.map(c => c.url).join(', ') || '—'}`)
  try {
    enforceAiLimit(user)
    const answer = await askBitrixGpt({ messages: [{ role: 'system', content: kbSystemPrompt(chosen) }, ...messages], json: false })
    return { answer: answer.trim(), sources: kbSources(chosen, pages) }
  } catch (e) {
    throw aiHttpError(e)
  }
})
