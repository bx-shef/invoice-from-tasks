// Какая сборка запущена — для GET /api/health. Коммит зашивает в образ CI (Dockerfile, ARG
// COMMIT_SHA): по нему с сервера видно, докатил ли Watchtower новый образ, и на какой
// `sha-<7 знаков>` откатываться (docs/DEPLOY.md, «Откат»).

/**
 * Коммит сборки из окружения: только полный SHA git (40 шестнадцатеричных знаков).
 * health открыт без входа, поэтому произвольный текст из переменной наружу не отдаём —
 * вдруг туда по ошибке попало что-то чужое.
 *
 * @returns SHA в нижнем регистре или `null`: не задан (локальная сборка) или не похож на SHA
 */
export function buildCommit(raw: string | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? ''
  return /^[0-9a-f]{40}$/.test(value) ? value : null
}
