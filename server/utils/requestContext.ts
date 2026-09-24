// Общая обвязка API-обработчиков: кто пришёл и какими клиентами Битрикс24 ему служить.
// Использует автоимпорты Nitro (useStorage, createError, getRequestHeaders), поэтому живёт
// отдельно от чистых модулей, которые покрыты юнит-тестами.

import type { H3Event } from 'h3'
import { makeFrameCall, makePortalCall, oauthCredsFromEnv, type RestCall } from './b24Client'
import { extractFrameAuth, verifyFrame, type FrameUser } from './frameAuth'
import { refreshTokenOf, updateTokens, type KeyValue } from './tokenStore'

/** Хранилище установок (fs-драйвер, см. `nitro.storage` в nuxt.config.ts). */
export function portalStore(): KeyValue {
  return useStorage('portals') as unknown as KeyValue
}

export interface RequestContext {
  user: FrameUser
  /** REST от имени пользователя фрейма — его права. */
  frameCall: RestCall
}

/** Проверяет фрейм-токен запроса. Бросает h3-ошибку с кодом, если пустить нельзя. */
export async function requireFrameUser(event: H3Event): Promise<RequestContext> {
  const headers = getRequestHeaders(event)
  const auth = extractFrameAuth({ get: name => headers[name] })
  if (!auth) throw createError({ statusCode: 400, statusMessage: 'frame auth headers required' })
  const creds = oauthCredsFromEnv()
  const verdict = await verifyFrame(auth, {
    kv: portalStore(),
    call: (domain, token, method) => makeFrameCall(domain, token, creds)(method),
    appCode: process.env.B24_APP_CODE?.trim() || ''
  })
  if (!verdict.ok) throw createError({ statusCode: verdict.status, statusMessage: verdict.error })
  return { user: verdict.user, frameCall: makeFrameCall(auth.domain, auth.accessToken, creds) }
}

/**
 * REST от имени администратора-установщика (сохранённый токен). Нужен только там, где права
 * пользователя недостаточны по документации, — сейчас это запись ставок не-администратором.
 */
export function installerCall(user: FrameUser): RestCall {
  const kv = portalStore()
  const p = user.portal
  return makePortalCall(
    {
      domain: p.domain,
      memberId: p.memberId,
      accessToken: p.accessToken,
      refreshToken: refreshTokenOf(p),
      expiresAt: p.expiresAt,
      applicationToken: p.applicationToken
    },
    oauthCredsFromEnv(),
    tokens => updateTokens(kv, p.memberId, tokens)
  )
}
