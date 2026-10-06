// GET /qr/<домен портала>/<ID счёта>.png — QR-код адреса публичной страницы счёта. Картинку берёт
// генератор документов Битрикс24 из поля счёта (без авторизации — так требует документация
// «Сгенерировать документ с изображениями»). В коде — только адрес страницы, без кода доступа;
// данные счёта сервер здесь не читает, поэтому отдаём всем.

import QRCode from 'qrcode'
import { publicInvoiceUrl, qrInvoiceId } from '#shared/domain/invoiceLinks'
import { isAllowedPortalHost, parseSelfHostedHosts, portalHostname } from '../../../utils/b24Host'

export default defineEventHandler(async (event) => {
  const domain = portalHostname(getRouterParam(event, 'domain') ?? '')
  const id = qrInvoiceId(getRouterParam(event, 'file'))
  const siteUrl = useRuntimeConfig().public.siteUrl
  if (!id || !domain || !isAllowedPortalHost(domain, parseSelfHostedHosts(process.env.B24_SELFHOSTED_HOSTS))) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  if (!siteUrl) throw createError({ statusCode: 503, statusMessage: 'SITE_URL не задан' })
  const png = await QRCode.toBuffer(publicInvoiceUrl(siteUrl, domain, id), { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 300 })
  setResponseHeader(event, 'Content-Type', 'image/png')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=86400')
  return png
})
