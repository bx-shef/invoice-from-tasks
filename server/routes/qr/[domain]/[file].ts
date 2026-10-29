// GET и HEAD /qr/<домен портала>/<ID счёта>.png — QR-код адреса публичной страницы счёта. Картинку берёт
// генератор документов Битрикс24 из поля счёта (без авторизации — так требует документация
// «Сгенерировать документ с изображениями»). В коде — только адрес страницы, без кода доступа;
// данные счёта сервер здесь не читает, поэтому отдаём всем.

import QRCode from 'qrcode'
import sharp from 'sharp'
import { qrStyleOf, qrSvg } from '#shared/domain/qrSvg'
import { publicInvoiceUrl, qrInvoiceId } from '#shared/domain/invoiceLinks'
import { isAllowedPortalHost, parseSelfHostedHosts, portalHostname } from '../../../utils/b24Host'

/**
 * Готовые PNG по «домен/счёт/стиль»: растеризация sharp — самое дорогое здесь, а адрес публичный
 * (ревью безопасности PR #80). Картинка от данных счёта не зависит — кешу нечего устаревать.
 */
const pngCache = new Map<string, Buffer>()
const MAX_PNG_CACHE = 500

export default defineEventHandler(async (event) => {
  // HEAD — как GET: иначе запрос уходил на страницу сайта (text/html), и проверка картинки
  // по заголовкам видела не PNG (2026-10-26, QR пропал из печатных форм счёта 153).
  if (event.method !== 'GET' && event.method !== 'HEAD') throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  const domain = portalHostname(getRouterParam(event, 'domain') ?? '')
  const id = qrInvoiceId(getRouterParam(event, 'file'))
  const siteUrl = useRuntimeConfig().public.siteUrl
  if (!id || !domain || !isAllowedPortalHost(domain, parseSelfHostedHosts(process.env.B24_SELFHOSTED_HOSTS))) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  if (!siteUrl) throw createError({ statusCode: 503, statusMessage: 'SITE_URL не задан' })
  // Фирменный вид (дизайн v2): коррекция H — выдерживает знак в центре; 600 px — для печати.
  // `?style=bw` — чёрно-белый. Матрица — qrcode, рисунок — shared/domain/qrSvg, PNG — sharp.
  const style = qrStyleOf(getQuery(event).style)
  const key = `${domain}/${id}/${style}`
  let png = pngCache.get(key)
  if (!png) {
    const { modules } = QRCode.create(publicInvoiceUrl(siteUrl, domain, id), { errorCorrectionLevel: 'H' })
    const svg = qrSvg({ size: modules.size, get: (r, c) => Boolean(modules.get(r, c)) }, style)
    png = await sharp(Buffer.from(svg)).resize(600, 600).png().toBuffer()
    if (pngCache.size >= MAX_PNG_CACHE) pngCache.delete(pngCache.keys().next().value!)
    pngCache.set(key, png)
  }
  setResponseHeader(event, 'Content-Type', 'image/png')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=86400')
  return png
})
