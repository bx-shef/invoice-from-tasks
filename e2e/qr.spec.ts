import { expect, test } from '@playwright/test'
import zxing from '@zxing/library'
import sharp from 'sharp'

// CommonJS-пакет: именованный импорт в ESM Playwright не работает
const { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } = zxing

// Генератор документов Битрикс24 берёт картинку QR по адресу из поля счёта. И GET, и HEAD должны
// отвечать PNG: HEAD уходил на страницу сайта (text/html) — QR пропал из печатных форм (2026-10-26).
test('QR счёта: GET и HEAD отдают PNG', async ({ request }) => {
  for (const method of ['get', 'head'] as const) {
    const res = await request[method]('/qr/bel.bitrix24.by/153.png')
    expect(res.status(), method).toBe(200)
    expect(res.headers()['content-type'], method).toBe('image/png')
  }
})

// Фирменный QR (знак в центре, перелив) читается сканером на трёх размерах и в ч/б (дизайн v2).
test('QR счёта читается: 180, 300, 600 px и ч/б', async ({ request, baseURL }) => {
  const want = `${baseURL}/p-bel.bitrix24.by/i-153`
  for (const style of ['', '?style=bw']) {
    const png = await (await request.get(`/qr/bel.bitrix24.by/153.png${style}`)).body()
    for (const size of [180, 300, 600]) {
      const { data, info } = await sharp(png).resize(size, size).greyscale().raw().toBuffer({ resolveWithObject: true })
      const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)))
      expect(new QRCodeReader().decode(bitmap).getText(), `${size}${style}`).toBe(want)
    }
  }
})
