import { defineConfig, devices } from '@playwright/test'

// Сквозные тесты страниц на подставных данных (#9): собранный сервер, ответы /api/public/* —
// подменой в браузере (портал не нужен). Справка — настоящая: страницы docs/guide едут в сборку.
// Скриншоты — вложениями отчёта (смотреть глазами), сверка — по DOM: пиксели шрифтов на разных
// машинах разные, сравнение картинок давало бы ложные падения.
// Локально в облачной сессии браузер уже стоит: PW_CHROMIUM=/opt/pw-browsers/chromium.
const PORT = 3123
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: 'on',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: `node .output/server/index.mjs`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { PORT: String(PORT), HOST: '127.0.0.1', NUXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PORT}` },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
})
