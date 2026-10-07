// POST /api/ai/estimate — оценка часов BitrixGPT для задач без затраченного времени
// (shared/domain/estimate.ts). Промпт — на сервере, не из тела запроса. Лимит — общий AI-лимит
// сотрудника, вес — число задач. Тексты задач в журнал не пишем.

import { buildEstimateMessages, parseEstimateItems, pickEstimates } from '#shared/domain/estimate'
import { askBitrixGpt, enforceAiLimit } from '../../utils/aiGateway'
import { extractJson } from '../../utils/llm'
import { aiHttpError, requireFrameUser } from '../../utils/requestContext'

export default defineEventHandler(async (event) => {
  const { user } = await requireFrameUser(event)
  const items = parseEstimateItems(await readBody(event))
  if (!items) throw createError({ statusCode: 400, statusMessage: 'Неверный запрос оценки' })
  try {
    enforceAiLimit(user, { weight: items.length })
    const answer = await askBitrixGpt({ messages: buildEstimateMessages(items), json: true })
    return { hours: pickEstimates(extractJson(answer), items.map(i => i.key)) }
  } catch (e) {
    throw aiHttpError(e)
  }
})
