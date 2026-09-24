// POST /api/ai/names — названия строк счёта через BitrixGPT (режим названий «ИИ»).
// Промпт берётся из настроек ПОРТАЛА (сервер читает app.option сам), а не из тела запроса:
// иначе эндпоинт превратился бы в бесплатный доступ к модели с любым системным промптом.

import { buildNamingMessages, MAX_NAMING_ITEMS, pickNames, type NamingItem } from '#shared/domain/prompts'
import { parseSettings, SETTINGS_KEY } from '#shared/domain/settings'
import { askBitrixGpt, enforceAiLimit } from '../../utils/aiGateway'
import { extractJson } from '../../utils/llm'
import { readOption } from '../../utils/options'
import { aiHttpError, requireFrameUser } from '../../utils/requestContext'

function parseItems(raw: unknown): NamingItem[] {
  if (!Array.isArray(raw)) return []
  const out: NamingItem[] = []
  for (const item of raw) {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const key = typeof o.key === 'string' ? o.key : ''
    if (!/^[te]\d{1,12}$/.test(key)) continue
    out.push({
      key,
      title: typeof o.title === 'string' ? o.title : '',
      text: typeof o.text === 'string' ? o.text : '',
      ...(typeof o.result === 'string' ? { result: o.result } : {})
    })
  }
  return out
}

export default defineEventHandler(async (event) => {
  const { user, frameCall } = await requireFrameUser(event)
  const body = await readBody<{ mode?: unknown, items?: unknown }>(event)
  const mode = body?.mode === 'task' || body?.mode === 'time' ? body.mode : null
  // Больше пакета — отказ, а не молчаливая обрезка: обрезанные строки вернулись бы без названий.
  if (Array.isArray(body?.items) && body.items.length > MAX_NAMING_ITEMS) {
    throw createError({ statusCode: 413, statusMessage: `at most ${MAX_NAMING_ITEMS} items per request` })
  }
  const items = parseItems(body?.items)
  if (!mode || items.length === 0) throw createError({ statusCode: 400, statusMessage: 'mode and items required' })

  try {
    enforceAiLimit(user)
    const settings = parseSettings(await readOption(frameCall, SETTINGS_KEY))
    const custom = mode === 'task' ? settings.prompts.taskTitle : settings.prompts.timeBlock
    const answer = await askBitrixGpt({ messages: buildNamingMessages(mode, custom, items), json: true })
    return { names: pickNames(extractJson(answer), items.map(i => i.key)) }
  } catch (e) {
    throw aiHttpError(e)
  }
})
