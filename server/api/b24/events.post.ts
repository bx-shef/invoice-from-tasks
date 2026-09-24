// POST /api/b24/events — входящие события портала: установка и удаление приложения.
// Тело — PHP-скобочная форма. Подлинность — application_token (fail-closed) и, при
// установке, сверка member_id через OAuth-сервер. Контракт — docs/B24_EVENTS.md.

import {
  appTokenVerdict,
  B24_EVENT_INSTALL,
  B24_EVENT_UNINSTALL,
  eventCode,
  parseBracketForm,
  parseEventAuth
} from '../../utils/b24Events'
import { oauthCredsFromEnv } from '../../utils/b24Client'
import { assertPortalHost } from '../../utils/b24Host'
import { portalStore } from '../../utils/requestContext'
import { getPortal, removePortal, saveInstall } from '../../utils/tokenStore'
import { rawOauthRefresh, verifyInstallMember, type OAuthFetchFn } from '../../utils/verifyInstallMember'

export default defineEventHandler(async (event) => {
  const envToken = process.env.B24_APPLICATION_TOKEN?.trim() || ''
  const kv = portalStore()
  try {
    const payload = parseBracketForm((await readRawBody(event)) || '')
    const code = eventCode(payload)
    if (code !== B24_EVENT_INSTALL && code !== B24_EVENT_UNINSTALL) {
      setResponseStatus(event, 200)
      return { ok: true, ignored: code || 'empty' }
    }

    let auth
    try {
      auth = parseEventAuth(payload)
      assertPortalHost(auth.domain)
    } catch {
      setResponseStatus(event, 400)
      return { error: 'malformed event' }
    }

    if (code === B24_EVENT_UNINSTALL) {
      const stored = await getPortal(kv, auth.memberId)
      const verdict = appTokenVerdict({ isInstall: false, incoming: auth.applicationToken, envToken, storedToken: stored?.applicationToken })
      if (verdict !== 'accept') {
        setResponseStatus(event, verdict === 'unconfigured' ? 503 : 403)
        return { error: `application_token ${verdict}` }
      }
      // Удалили приложение — не держим о портале ничего.
      await removePortal(kv, auth.memberId)
      console.info(`[b24-events] uninstall member_id=${auth.memberId}`)
      return { ok: true }
    }

    const verdict = appTokenVerdict({ isInstall: true, incoming: auth.applicationToken, envToken })
    if (verdict !== 'accept') {
      setResponseStatus(event, 403)
      return { error: `application_token ${verdict}` }
    }

    // ⚠ Fail-closed без реквизитов OAuth. Замер 2026-09-24 (docs/B24_EVENTS.md): без сверки
    // member_id повторная «установка» с тем же member_id и ЧУЖИМИ токенами перезаписывала токены
    // портала — ставки потом писались бы чужим токеном. Эталон в этом случае деградирует до
    // проверки одного application_token; мы — нет: без реквизитов токен всё равно не обновить.
    const creds = oauthCredsFromEnv()
    if (!creds.clientId || !creds.clientSecret) {
      console.error('[b24-events] B24_CLIENT_ID/B24_CLIENT_SECRET not set — install NOT stored')
      setResponseStatus(event, 503)
      return { error: 'server not configured' }
    }
    const bound = await verifyInstallMember(auth.memberId, auth.refreshToken, rawOauthRefresh(globalThis.fetch as unknown as OAuthFetchFn, creds))
    if (!bound.ok || !bound.grant) {
      setResponseStatus(event, bound.status ?? 503)
      return { error: 'install member_id not verified' }
    }

    await saveInstall(kv, { memberId: auth.memberId, domain: auth.domain, applicationToken: auth.applicationToken, ...bound.grant })
    console.info(`[b24-events] install member_id=${auth.memberId}`)
    return { ok: true }
  } catch (err) {
    // Текст ошибки может нести member_id, но не токены; наружу — только общий ответ.
    console.error(`[b24-events] handler error: ${(err as Error)?.message}`)
    setResponseStatus(event, 500)
    return { error: 'internal error' }
  }
})
