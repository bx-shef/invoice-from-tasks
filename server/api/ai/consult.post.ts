// POST /api/ai/consult — запуск промпта консультации из настроек над данными счёта.
// Выбор промпта — `findConsultPrompt` (server/utils/aiRequests.ts, покрыт тестами): текст берётся
// из настроек портала по id. Ответ возвращается странице, а та кладёт его делом в счёт (правами
// сотрудника — crm.activity.todo.add во фрейме).

import { buildConsultMessages } from '#shared/domain/prompts'
import { parseSettings, SETTINGS_KEY } from '#shared/domain/settings'
import { askBitrixGpt, enforceAiLimit } from '../../utils/aiGateway'
import { findConsultPrompt } from '../../utils/aiRequests'
import { readOption } from '../../utils/options'
import { CONSULT_WEIGHT } from '../../utils/rateLimit'
import { aiHttpError, requireFrameUser } from '../../utils/requestContext'

export default defineEventHandler(async (event) => {
  const { user, frameCall } = await requireFrameUser(event)
  const body = await readBody(event)
  const settings = parseSettings(await readOption(frameCall, SETTINGS_KEY))
  const found = findConsultPrompt(settings, body)
  if (!found.ok) throw createError({ statusCode: found.status, statusMessage: found.error })
  const { prompt, context } = found.value

  try {
    enforceAiLimit(user, { weight: CONSULT_WEIGHT })
    const answer = await askBitrixGpt({ messages: buildConsultMessages(prompt.text, context), json: false })
    return { title: prompt.title, text: answer.trim() }
  } catch (e) {
    throw aiHttpError(e)
  }
})
