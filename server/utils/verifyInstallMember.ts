// Привязка member_id при установке (защита от «отравления установки»). Перенесено из
// client-bank-alfa-by (server/utils/verifyInstallMember.ts, #162 там).
//
// Суть угрозы: member_id в ONAPPINSTALL — поле, которое присылает клиент, а application_token
// общий для всех установок приложения. Установив наше приложение на СВОЙ портал, злоумышленник
// может прислать «установку» с ЧУЖИМ member_id и своими токенами — и записи ставок чужого
// портала пошли бы через его токен. Защита: обновляем присланный refresh_token на OAuth-сервере
// Битрикс24 — ответ несёт НАСТОЯЩИЙ member_id этого гранта, и он обязан совпасть с заявленным.
// Обновление РОТИРУЕТ токен: сохранять нужно вернувшийся грант, присланный уже истрачен.
//
// Хост OAuth фиксированный (не из запроса) — SSRF здесь нет; секреты идут в теле, не в URL.

const OAUTH_TOKEN_URL = 'https://oauth.bitrix.info/oauth/token/'
export const INSTALL_VERIFY_TIMEOUT_MS = 15_000

/** Коды OAuth, означающие «грант поддельный» → 403. Остальное — «не можем проверить» → 503. */
const GRANT_REJECTION_CODES = new Set(['invalid_grant', 'invalid_token', 'expired_token'])

export interface OAuthCreds {
  clientId: string
  clientSecret: string
}

export type OAuthFetchFn = (url: string, init: { method: string, headers: Record<string, string>, body: string, signal?: AbortSignal }) => Promise<{ json: () => Promise<unknown> }>

/** Сырой POST обновления токена. Секреты — в теле формы, не в строке запроса (не попадут в логи). */
export function rawOauthRefresh(fetchFn: OAuthFetchFn, creds: OAuthCreds, timeoutMs = INSTALL_VERIFY_TIMEOUT_MS) {
  return async (refreshToken: string): Promise<unknown> => {
    const res = await fetchFn(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: refreshToken
      }).toString(),
      signal: AbortSignal.timeout(timeoutMs)
    })
    return res.json()
  }
}

export interface RefreshedGrant {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface InstallMemberResult {
  ok: boolean
  /** 403 — member_id не совпал / грант поддельный; 503 — проверить сейчас нельзя. */
  status?: 403 | 503
  grant?: RefreshedGrant
}

/** Сверяет заявленный member_id с настоящим из OAuth-гранта. Никогда не бросает. */
export async function verifyInstallMember(claimedMemberId: string, refreshToken: string, refresh: (rt: string) => Promise<unknown>): Promise<InstallMemberResult> {
  const claimed = claimedMemberId.trim().toLowerCase()
  if (!claimed || !refreshToken) return { ok: false, status: 403 }
  let raw: unknown
  try {
    raw = await refresh(refreshToken)
  } catch {
    return { ok: false, status: 503 }
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const accessToken = typeof o.access_token === 'string' ? o.access_token : ''
  if (!accessToken) {
    return { ok: false, status: GRANT_REJECTION_CODES.has(String(o.error)) ? 403 : 503 }
  }
  const authoritative = String(o.member_id ?? '').trim().toLowerCase()
  if (!authoritative) return { ok: false, status: 503 }
  if (authoritative !== claimed) return { ok: false, status: 403 }
  const expiresIn = Number(o.expires_in)
  return {
    ok: true,
    grant: {
      accessToken,
      refreshToken: typeof o.refresh_token === 'string' ? o.refresh_token : '',
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600
    }
  }
}
