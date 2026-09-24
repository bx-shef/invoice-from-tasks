// POST /api/settings — сохранение общих настроек. Только администратор портала
// (app.option.set по документации доступен лишь ему — пишем его же токеном).
// Тело нормализуется тем же разбором, что и при чтении: в хранилище не попадает ничего лишнего.

import { parseSettings, serializeSettings, SETTINGS_KEY } from '#shared/domain/settings'
import { writeOptionWithinBudget } from '../utils/options'
import { requireFrameUser } from '../utils/requestContext'

export default defineEventHandler(async (event) => {
  const { user, frameCall } = await requireFrameUser(event)
  if (!user.isAdmin) throw createError({ statusCode: 403, statusMessage: 'settings write requires a portal administrator' })

  const body = await readBody<{ settings?: unknown }>(event)
  if (!body || typeof body.settings !== 'object' || body.settings === null) {
    // Пустое тело — не повод сбросить настройки портала к умолчаниям.
    throw createError({ statusCode: 400, statusMessage: 'settings required' })
  }
  const value = serializeSettings(parseSettings(body.settings))
  const outcome = await writeOptionWithinBudget(frameCall, frameCall, SETTINGS_KEY, value)
  if (!outcome.ok) {
    setResponseStatus(event, 413)
    return { error: 'storage budget exceeded', usage: outcome.usage }
  }
  return { ok: true, usage: outcome.usage }
})
