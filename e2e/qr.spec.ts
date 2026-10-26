import { expect, test } from '@playwright/test'

// Генератор документов Битрикс24 берёт картинку QR по адресу из поля счёта. И GET, и HEAD должны
// отвечать PNG: HEAD уходил на страницу сайта (text/html) — QR пропал из печатных форм (2026-10-26).
test('QR счёта: GET и HEAD отдают PNG', async ({ request }) => {
  for (const method of ['get', 'head'] as const) {
    const res = await request[method]('/qr/bel.bitrix24.by/153.png')
    expect(res.status(), method).toBe(200)
    expect(res.headers()['content-type'], method).toBe('image/png')
  }
})
