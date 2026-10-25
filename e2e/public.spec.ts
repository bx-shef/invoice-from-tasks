import { expect, test } from '@playwright/test'
import { mockPublicApi } from './fixtures'

const URL = '/p-example.bitrix24.by/i-145'

test('публичная страница: вход по коду, счёт и решения по задачам', async ({ page }, info) => {
  const log = await mockPublicApi(page)
  await page.goto(URL)
  const open = page.getByTestId('public-open')
  await expect(open).toBeVisible()
  await info.attach('login', { body: await page.screenshot(), contentType: 'image/png' })

  await page.locator('[data-testid=public-code] input, input#access-code').first().fill('J7AWBZDDRy')
  await open.click()
  await expect(page.getByTestId('public-summary')).toBeVisible()
  expect(log.invoice.length).toBeGreaterThan(0)
  await expect(page.getByTestId('public-row').filter({ hasText: 'Импорт банковских выписок' })).toBeVisible()

  const yes = page.getByTestId('public-decide-yes')
  await expect(yes).toHaveCount(2)
  await yes.first().click()
  await expect.poll(() => log.decide.length).toBeGreaterThan(0)
  await info.attach('invoice', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
})

test('публичная страница: тёмная тема по системной', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await mockPublicApi(page)
  await page.goto(URL)
  await expect(page.getByTestId('public-open')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('публичная страница: «Отложить» спрашивает срок и отправляет его', async ({ page }) => {
  const log = await mockPublicApi(page)
  await page.goto(URL)
  await page.locator('[data-testid=public-code] input, input#access-code').first().fill('J7AWBZDDRy')
  await page.getByTestId('public-open').click()
  await page.getByTestId('public-decide-later').first().click()
  await page.getByTestId('public-postpone-2w').click()
  await expect.poll(() => JSON.stringify(log.decide.at(-1))).toContain('"87":"later:2w"')
})

test('публичная страница: плавающая «Замечание» открывает окно с полем', async ({ page }, info) => {
  await mockPublicApi(page)
  await page.goto(URL)
  await page.locator('[data-testid=public-code] input, input#access-code').first().fill('J7AWBZDDRy')
  await page.getByTestId('public-open').click()
  await page.getByTestId('public-comment-fab').click()
  await expect(page.getByTestId('public-comment-text')).toBeVisible()
  await info.attach('comment', { body: await page.screenshot(), contentType: 'image/png' })
})
