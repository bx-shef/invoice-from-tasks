// POST /api/rates — сохранение ставок часа. Может администратор портала или сотрудник из
// списка `rateEditors` в настройках (ТЗ).
//
// ⚠ Почему через сервер. app.option.set доступен ТОЛЬКО администратору (документация метода,
// ошибка «Administrator authorization required»). Назначенный редактор ставок не администратор —
// его токеном записать нельзя. Поэтому сервер: проверяет, кто пришёл, читает список редакторов
// из настроек портала (не из запроса!) и пишет токеном администратора-установщика.

import { parseRates, serializeRates, validateRates, type RateEntry } from '#shared/domain/rates'
import { canEditRates, parseSettings, RATES_KEY, SETTINGS_KEY } from '#shared/domain/settings'
import { readOption, writeOptionWithinBudget } from '../utils/options'
import { installerCall, requireFrameUser } from '../utils/requestContext'

export default defineEventHandler(async (event) => {
  const { user, frameCall } = await requireFrameUser(event)

  // Список редакторов — из хранилища портала. Значение из тела запроса подделывается тривиально.
  const settings = parseSettings(await readOption(frameCall, SETTINGS_KEY))
  if (!canEditRates(settings, user.userId, user.isAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'rates write requires an administrator or a rate editor' })
  }

  const body = await readBody<{ rates?: unknown }>(event)
  if (!body || !Array.isArray(body.rates)) throw createError({ statusCode: 400, statusMessage: 'rates array required' })
  const entries = body.rates as RateEntry[]
  const issues = validateRates(entries)
  if (issues.length) {
    setResponseStatus(event, 422)
    return { error: 'invalid rates', issues }
  }
  // Круг «сериализация → разбор» отбрасывает посторонние поля записей.
  const value = serializeRates(parseRates(serializeRates(entries)))

  // Администратор пишет своим токеном; редактор — токеном установщика.
  const writer = user.isAdmin ? frameCall : installerCall(user)
  const outcome = await writeOptionWithinBudget(frameCall, writer, RATES_KEY, value)
  if (!outcome.ok) {
    setResponseStatus(event, 413)
    return { error: 'storage budget exceeded', usage: outcome.usage }
  }
  console.info(`[rates] saved by user=${user.userId} admin=${user.isAdmin} entries=${entries.length} bytes=${outcome.usage.bytes}`)
  return { ok: true, usage: outcome.usage }
})
