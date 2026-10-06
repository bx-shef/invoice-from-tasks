// Вызовы REST Битрикс24 с сервера — через @bitrix24/b24jssdk (класс B24OAuth), как в эталоне
// client-bank-alfa-by (server/utils/b24Sdk.ts). Два вида клиента:
//   • по фрейм-токену пользователя — права этого пользователя, обновить токен нельзя;
//   • по сохранённому токену установки — права администратора-установщика, с рефрешем.
// Все исходящие методы перечислены в docs/REST_METHODS.md.

import { B24OAuth } from '@bitrix24/b24jssdk'
import type { B24OAuthParams } from '@bitrix24/b24jssdk'
import { assertPortalHost, DEFAULT_OAUTH_HOST } from './b24Host'
import type { OAuthCreds } from './verifyInstallMember'

/** Вызов REST-метода: результат (`result` конверта) или исключение с текстом ошибок портала. */
export type RestCall = (method: string, params?: Record<string, unknown>) => Promise<unknown>

/** Сообщение, по которому видно, что фрейм-токен отвергнут (обновить его на сервере нельзя). */
export const FRAME_TOKEN_REJECTED = 'frame token rejected'

interface TokenInput {
  domain: string
  memberId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  applicationToken: string
  /** Сервер авторизации портала (запись о портале); не задан — по умолчанию. */
  oauthHost?: string
}

/**
 * Параметры B24OAuth из нашей записи о токене. Хост портала проходит SSRF-гард. Сервер
 * авторизации — свой у портала (`auth[server_endpoint]` установки): SDK шлёт рефреш на
 * `<serverEndpoint без /rest/>/oauth/token/`.
 */
export function oauthParams(token: TokenInput, nowMs: number): B24OAuthParams {
  const domain = assertPortalHost(token.domain)
  return {
    applicationToken: token.applicationToken,
    userId: 0,
    memberId: token.memberId,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expires: Math.floor(token.expiresAt / 1000),
    expiresIn: Math.max(0, Math.floor((token.expiresAt - nowMs) / 1000)),
    scope: '',
    domain,
    clientEndpoint: `https://${domain}/rest/`,
    serverEndpoint: `https://${token.oauthHost || DEFAULT_OAUTH_HOST}/rest/`,
    status: 'L'
  }
}

/** Структурный срез клиента SDK, который мы зовём, — тесты подсовывают подделку. */
type SdkMake = (o: { method: string, params?: Record<string, unknown> }) => Promise<{
  isSuccess: boolean
  getData: () => { result?: unknown } | undefined
  getErrorMessages: () => string[]
}>

export interface SdkCallClient {
  actions: {
    v2: { call: { make: SdkMake } }
    v3?: { call: { make: SdkMake } }
  }
}

/** Приставка имени метода для REST v3: `v3:tasks.task.result.list` (метод есть только в v3). */
export const V3_PREFIX = 'v3:'

/**
 * Обёртка клиента в `RestCall`: разворачивает конверт или бросает с сообщениями портала. Метод с
 * приставкой {@link V3_PREFIX} уходит в REST v3 (`actions.v3`) — один `RestCall` на обе версии,
 * чтобы обёртки токена установщика (очередь, обновление токена) не дублировать.
 */
export function restCallFrom(client: SdkCallClient): RestCall {
  return async (name, params = {}) => {
    const v3 = name.startsWith(V3_PREFIX)
    const method = v3 ? name.slice(V3_PREFIX.length) : name
    const api = v3 ? client.actions.v3 : client.actions.v2
    if (!api) throw new Error(`${method}: REST v3 is not available in this SDK client`)
    const res = await api.call.make({ method, params })
    if (!res.isSuccess) throw new Error(`${method}: ${res.getErrorMessages().join('; ') || 'unknown error'}`)
    return res.getData()?.result
  }
}

/**
 * Клиент по фрейм-токену. Своего refresh-токена у сервера нет: любая ошибка авторизации —
 * окончательный отказ, а не «обнови меня» (иначе SDK POST-ил бы пустой refresh_token).
 */
export function makeFrameCall(domain: string, accessToken: string, creds: OAuthCreds, nowMs = Date.now()): RestCall {
  const client = new B24OAuth(oauthParams({
    domain, memberId: '', accessToken, refreshToken: '', expiresAt: nowMs + 3_600_000, applicationToken: ''
  }, nowMs), creds)
  client.setCustomRefreshAuth(() => Promise.reject(new Error(FRAME_TOKEN_REJECTED)))
  return restCallFrom(client)
}

/**
 * Клиент по сохранённому токену установки. SDK сам обновит просроченный access-токен и
 * отдаст новые токены в `persist` — их надо сохранить, иначе следующий вызов начнёт со старого.
 */
export function makePortalCall(
  token: TokenInput,
  creds: OAuthCreds,
  persist: (t: { accessToken: string, refreshToken: string, expiresAt: number }) => Promise<void>,
  nowMs = Date.now()
): RestCall {
  const client = new B24OAuth(oauthParams(token, nowMs), creds)
  client.setCallbackRefreshAuth(async ({ b24OAuthParams }) => {
    await persist({
      accessToken: b24OAuthParams.accessToken,
      refreshToken: b24OAuthParams.refreshToken,
      expiresAt: b24OAuthParams.expires * 1000
    })
  })
  return restCallFrom(client)
}

/** OAuth-реквизиты приложения из окружения; пустые строки — не заданы. */
export function oauthCredsFromEnv(env: Record<string, string | undefined> = process.env): OAuthCreds {
  return {
    clientId: env.B24_CLIENT_ID?.trim() || '',
    clientSecret: env.B24_CLIENT_SECRET?.trim() || ''
  }
}
