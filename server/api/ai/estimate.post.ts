// POST /api/ai/estimate — оценка часов BitrixGPT для задач без затраченного времени
// (shared/domain/estimate.ts). Промпт — из настроек портала (или системный), не из тела запроса. Лимит — общий AI-лимит
// сотрудника, вес — число задач. Тексты задач в журнал не пишем.

import { buildEstimateMessages, parseEstimateItems, pickEstimates } from '#shared/domain/estimate'
import { askBitrixGpt, enforceAiLimit } from '../../utils/aiGateway'
import { parseSettings, SETTINGS_KEY } from '#shared/domain/settings'
import { extractJson } from '../../utils/llm'
import { readOption } from '../../utils/options'
import { aiHttpError, requireFrameUser } from '../../utils/requestContext'

export default defineEventHandler(async (event) => {
  const { user, frameCall } = await requireFrameUser(event)
  const items = parseEstimateItems(await readBody(event))
  if (!items) throw createError({ statusCode: 400, statusMessage: 'Неверный запрос оценки' })
  try {
    enforceAiLimit(user, { weight: items.length })
    // Промпт — из настроек ПОРТАЛА (как у названий), не из тела запроса.
    const settings = parseSettings(await readOption(frameCall, SETTINGS_KEY))
    const answer = await askBitrixGpt({ messages: buildEstimateMessages(items, settings.prompts.estimate), json: true })
    return { hours: pickEstimates(extractJson(answer), items.map(i => i.key)) }
  } catch (e) {
    throw aiHttpError(e)
  }
})
