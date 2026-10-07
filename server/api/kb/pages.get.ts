// GET /api/kb/pages — публичная справка (docs/guide): страницы целиком, по порядку. Справка
// публичная, отдаём без фрейма — её же видит ИИ-чат.

import { loadKb } from '../../utils/requestContext'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')
  const { pages } = await loadKb()
  return { pages }
})
