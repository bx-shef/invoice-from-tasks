// POST /api/client-hook/seal — шифрует вебхук портала клиента для поля «Вебхук клиента» (#34).
// Вызывает обработчик поля в карточке компании или контакта; записывает значение в поле уже
// сотрудник своими правами (setValue / crm.item.update) — сервер в CRM не пишет. Решение —
// `sealClientHook` (server/utils/clientHook.ts, покрыт тестами). Сам вебхук в журнал не пишем.

import { requireFrameUser } from '../../utils/requestContext'
import { SEAL_LIMIT, sealClientHook } from '../../utils/clientHook'
import { SlidingWindow } from '../../utils/rateLimit'

/** Лимит на сотрудника портала: вебхук вводят руками, десятки в минуту — уже не человек. */
const sealWindows = new SlidingWindow()

export default defineEventHandler(async (event) => {
  const { user } = await requireFrameUser(event)
  if (!sealWindows.take([[`seal:${user.portal.memberId}:${user.userId}`, SEAL_LIMIT]])) {
    throw createError({ statusCode: 429, statusMessage: 'Слишком часто — попробуйте через минуту' })
  }
  const body = await readBody<{ url?: unknown } | null>(event)
  const result = sealClientHook(body?.url, user.portal.domain)
  if (!result.ok) throw createError({ statusCode: result.status, statusMessage: result.error })
  console.info(`[client-hook] sealed by user=${user.userId} host=${result.host}`)
  return { value: result.value, host: result.host }
})
