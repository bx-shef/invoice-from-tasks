// Пределы запросов к /api: размер тела и частота событий с одного IP (server/utils/requestLimits.ts).

import { bodyLimitFor, checkBodySize, EVENTS_PER_IP } from '../utils/requestLimits'
import { SlidingWindow } from '../utils/rateLimit'
import { clientIp } from '../utils/requestContext'

const eventWindows = new SlidingWindow()

export default defineEventHandler((event) => {
  const limit = bodyLimitFor(event.method, event.path)
  if (limit === null) return
  const verdict = checkBodySize(getRequestHeader(event, 'content-length'), limit)
  if (!verdict.ok) throw createError({ statusCode: verdict.status, statusMessage: verdict.status === 413 ? 'payload too large' : 'content-length required' })
  if (event.path.startsWith('/api/b24/events') && !eventWindows.take([[`ev:${clientIp(event)}`, EVENTS_PER_IP]])) {
    throw createError({ statusCode: 429, statusMessage: 'too many requests' })
  }
})
