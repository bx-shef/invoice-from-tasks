// POST /api/ai/consult — запуск промпта консультации из настроек над данными счёта.
// Текст промпта берётся из настроек портала по id; ответ возвращается странице, а та кладёт
// его делом в счёт (правами сотрудника — crm.activity.todo.add во фрейме).

import { buildConsultMessages } from '#shared/domain/prompts'
import { parseSettings, SETTINGS_KEY } from '#shared/domain/settings'
import { askBitrixGpt, enforceAiLimit } from '../../utils/aiGateway'
import { readOption } from '../../utils/options'
import { requireFrameUser } from '../../utils/requestContext'

export default defineEventHandler(async (event) => {
  const { user, frameCall } = await requireFrameUser(event)
  const body = await readBody<{ promptId?: unknown, context?: unknown }>(event)
  const promptId = typeof body?.promptId === 'string' ? body.promptId : ''
  if (!promptId) throw createError({ statusCode: 400, statusMessage: 'promptId required' })

  const settings = parseSettings(await readOption(frameCall, SETTINGS_KEY))
  const prompt = settings.consultPrompts.find(p => p.id === promptId)
  if (!prompt) throw createError({ statusCode: 404, statusMessage: 'prompt not found' })

  enforceAiLimit(user)
  const answer = await askBitrixGpt({ messages: buildConsultMessages(prompt.text, body?.context ?? {}), json: false })
  return { title: prompt.title, text: answer.trim() }
})
