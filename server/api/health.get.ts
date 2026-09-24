// GET /api/health — жив ли сервер и сконфигурирован ли он. Без секретов: только флаги «задано / нет».

export default defineEventHandler(() => ({
  ok: true,
  config: {
    siteUrl: Boolean(useRuntimeConfig().public.siteUrl),
    oauth: Boolean(process.env.B24_CLIENT_ID && process.env.B24_CLIENT_SECRET),
    tokenKey: Boolean(process.env.B24_TOKEN_ENC_KEY),
    bitrixGpt: Boolean(process.env.BITRIXGPT_API_KEY || process.env.VIBE_API_KEY)
  }
}))
