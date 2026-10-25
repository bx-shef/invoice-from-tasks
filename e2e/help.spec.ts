import { expect, test } from '@playwright/test'

test('справка: главная с плитками и переход на страницу', async ({ page }, info) => {
  await page.goto('/help')
  await expect(page.locator('h1').first()).toBeVisible()
  await info.attach('landing', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
})

test('справка: ссылка на вопрос FAQ раскрывает его', async ({ page }, info) => {
  await page.goto('/help?p=90-faq#rate-source')
  const item = page.locator('details[open]', { hasText: 'Откуда берётся ставка' })
  await expect(item.first()).toBeVisible()
  await info.attach('faq', { body: await page.screenshot(), contentType: 'image/png' })
})
