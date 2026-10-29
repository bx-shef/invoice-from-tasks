import { expect, test } from '@playwright/test'
import { mockPublicApi, sampleInvoice } from './fixtures'

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
  await expect(page.getByTestId('public-row-name').filter({ hasText: 'Импорт банковских выписок' })).toBeVisible()

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

test('публичная страница: «Написать» у работы подставляет её в поле замечания', async ({ page }, info) => {
  await mockPublicApi(page)
  await page.goto(URL)
  await page.locator('[data-testid=public-code] input, input#access-code').first().fill('J7AWBZDDRy')
  await page.getByTestId('public-open').click()
  await expect(page.getByTestId('public-comment-fab')).toHaveCount(0)
  await page.getByTestId('public-row').first().click()
  await page.getByTestId('public-row-comment').first().click()
  const text = page.locator('[data-testid=public-comment-text] textarea, textarea[data-testid=public-comment-text]').first()
  await expect(text).toBeFocused()
  await expect(text).toHaveValue(/^«Импорт банковских выписок»: /)
  await info.attach('comment', { body: await page.screenshot(), contentType: 'image/png' })
})

test('публичная страница: быстрые клики подряд не теряются, разрешённая работа подсвечена', async ({ page }) => {
  const inv = sampleInvoice()
  const log = await mockPublicApi(page, inv)
  // Медленная запись: второй клик — пока первый ещё пишется
  await page.route('**/api/public/decide', async (r) => {
    await new Promise(res => setTimeout(res, 400))
    const body = r.request().postDataJSON()
    log.decide.push(body)
    Object.assign(inv.invoice.approval.decisions, body.decisions)
    return r.fulfill({ json: { ok: true } })
  })
  await page.goto(URL)
  await page.locator('[data-testid=public-code] input, input#access-code').first().fill('J7AWBZDDRy')
  await page.getByTestId('public-open').click()
  const yes = page.getByTestId('public-decide-yes')
  await yes.nth(0).click()
  await yes.nth(1).click()
  await expect(yes.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await expect(yes.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => log.decide.length).toBe(2)
  await expect(page.locator('[data-decision=yes]')).toHaveCount(2)
  await expect(page.getByTestId('public-decide-yes').first()).toHaveAttribute('aria-pressed', 'true')
})

test('публичная страница: короткий код — ошибка под полем и для скринридера, ввод её снимает', async ({ page }) => {
  await mockPublicApi(page)
  await page.goto(URL)
  const input = page.locator('[data-testid=public-code] input, input#access-code').first()
  await input.fill('abc')
  await page.getByTestId('public-open').click()
  await expect(page.getByTestId('public-error')).toHaveText('Код доступа — 10 символов')
  await expect(page.getByText('Код доступа — 10 символов').first()).toBeVisible()
  await input.fill('abcd')
  await expect(page.getByTestId('public-error')).toHaveText('')
})

test('публичная страница: прогресс решений и липкая панель', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 740 })
  const log = await mockPublicApi(page)
  await page.goto(URL)
  await page.locator('[data-testid=public-code] input, input#access-code').first().fill('J7AWBZDDRy')
  await page.getByTestId('public-open').click()
  await expect(page.getByTestId('public-progress')).toBeVisible()
  await expect(page.getByTestId('public-decisions')).toBeVisible()
  await page.getByTestId('public-decide-all-yes').click()
  await expect.poll(() => JSON.stringify(log.decide.at(-1))).toContain('"yes"')
  await expect(page.getByTestId('public-progress')).toContainText('Решено')
  // Липкая панель на узком экране не шире экрана
  const bar = await page.getByTestId('public-decisions').boundingBox()
  expect(bar && bar.x >= 0 && bar.x + bar.width <= 360).toBe(true)
  const shot = await page.screenshot({ fullPage: false, path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/progress.png` : undefined })
  await info.attach('progress', { body: shot, contentType: 'image/png' })
})

test('публичная страница: строка работы — переключатель решения и подробности в строке', async ({ page }) => {
  const log = await mockPublicApi(page)
  await page.goto(URL)
  await page.locator('[data-testid=public-code] input, input#access-code').first().fill('J7AWBZDDRy')
  await page.getByTestId('public-open').click()
  const no = page.getByTestId('public-decide-no').first()
  await no.click()
  await expect(no).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => JSON.stringify(log.decide.at(-1))).toContain('"no"')
  await page.getByTestId('public-row').first().click()
  await expect(page.getByTestId('public-task').first()).toBeVisible()
  await expect(page.getByTestId('public-row').first()).toHaveText('Скрыть')
  await page.screenshot({ fullPage: true, path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/rows.png` : undefined })
})

test('публичная страница: замечания — переписка по порядку, ответ менеджера слева', async ({ page }) => {
  const inv = sampleInvoice()
  const approval = inv.invoice.approval as { comments: unknown[] }
  approval.comments = [
    { id: 2, created: '2026-10-28T18:00:00Z', text: 'Второе', closed: false, answer: null },
    { id: 1, created: '2026-10-28T17:00:00Z', text: 'Первое', closed: true, answer: 'Принято' }
  ]
  await mockPublicApi(page, inv)
  await page.goto(URL)
  await page.locator('[data-testid=public-code] input, input#access-code').first().fill('J7AWBZDDRy')
  await page.getByTestId('public-open').click()
  const mine = page.getByTestId('public-comment')
  await expect(mine).toHaveCount(2)
  await expect(mine.first()).toContainText('Первое')
  await expect(page.getByText('Принято')).toBeVisible()
  await page.screenshot({ fullPage: true, path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/thread.png` : undefined })
})
