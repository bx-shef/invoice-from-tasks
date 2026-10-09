// POST /api/kb/chat — ИИ-чат справки (по принципу toolsai/skills-site): `{ messages, page? }` →
// поток NDJSON (shared/domain/kbStream.ts): сначала страницы-источники, затем текст BitrixGPT по
// мере генерации. Отвечает по фрагментам публичной справки. Только из фрейма портала (модель
// платная) и в своём лимите — 30 вопросов за 10 минут на сотрудника (KB_CHAT_LIMITS). Вопросы и
// ответы в журнал не пишем. Лимит и пустой вопрос — обычной HTTP-ошибкой до начала потока;
// отказ модели посреди потока — событием `error`.

import { kbSources, kbSystemPrompt, parseKbMessages, selectChunks } from '#shared/domain/kb'
import { encodeKbEvent } from '#shared/domain/kbStream'
import { AiGatewayError, enforceKbChatLimit, streamBitrixGpt } from '../../utils/aiGateway'
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
    enforceKbChatLimit(user)
  } catch (e) {
    throw aiHttpError(e)
  }

  const answer = streamBitrixGpt({ messages: [{ role: 'system', content: kbSystemPrompt(chosen) }, ...messages], json: false })
  const enc = new TextEncoder()
  setResponseHeaders(event, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    // nginx-proxy иначе копит ответ целиком и отдаёт разом — поток пропадает
    'X-Accel-Buffering': 'no'
  })
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(enc.encode(encodeKbEvent({ type: 'sources', sources: kbSources(chosen, pages) })))
      try {
        for await (const text of answer) controller.enqueue(enc.encode(encodeKbEvent({ type: 'text', text })))
      } catch (e) {
        const message = e instanceof AiGatewayError ? e.message : 'BitrixGPT не ответил'
        controller.enqueue(enc.encode(encodeKbEvent({ type: 'error', message })))
      }
      controller.close()
    },
    async cancel() {
      // сотрудник закрыл окно — останавливаем генерацию у провайдера
      await answer.return(undefined)
    }
  })
})
