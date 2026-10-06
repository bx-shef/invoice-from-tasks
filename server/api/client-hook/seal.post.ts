// POST /api/client-hook/seal — шифрует вебхук портала клиента для поля «Вебхук клиента» (#34).
// Вызывает обработчик поля в карточке компании или контакта; записывает значение в поле уже
// сотрудник своими правами (setValue / crm.item.update) — сервер в CRM не пишет. Решение —
// `sealClientHook` (server/utils/clientHook.ts, покрыт тестами). Сам вебхук в журнал не пишем.

import { requireFrameUser } from '../../utils/requestContext'
import { sealClientHook } from '../../utils/clientHook'

export default defineEventHandler(async (event) => {
  const { user } = await requireFrameUser(event)
  const body = await readBody<{ url?: unknown } | null>(event)
  const result = sealClientHook(body?.url)
  if (!result.ok) throw createError({ statusCode: result.status, statusMessage: result.error })
  console.info(`[client-hook] sealed by user=${user.userId} host=${result.host}`)
  return { value: result.value, host: result.host }
})
