# Настройки репозитория (разово, владельцу)

> Last reviewed: 2026-09-25

Перенесено из эталона `client-bank-alfa-by`. Делается в интерфейсе GitHub один раз; агент
этого сделать не может и не должен (`docs/AGENT_RULES.md` §5.8).

## 1. Защита `main` — ruleset `protect-main`

Settings → Rules → Rulesets → New branch ruleset:

- **Enforcement:** Active; **Bypass list:** пусто; **Target:** default branch.
- **Restrict deletions** и **Block force pushes** — включить.
- **Require a pull request before merging** — включить; approvals — 0 или 1; «Dismiss stale
  approvals» и «Require conversation resolution» — включить.
- **Require status checks to pass** — включить, проверка **`ci`**, «Require branches to be up to
  date» — включить. `docker-build` обязательной не делаем: он идёт только на PR и нужен как
  сигнал, а не как стоп.

⚠ Имя джобы `ci` — то, на что ссылается правило. Переименуете джобу — защита молча перестанет
что-либо требовать; это стережёт `tests/repoGuards.test.ts`.

Проверка: попытка `git push --force` в `main` и удаление ветки должны отклоняться.

## 2. Ветки

Settings → General → **Automatically delete head branches** — включить.

## 3. Dependabot

Settings → Code security: alerts, security updates, version updates — включить.
Конфигурация — `.github/dependabot.yml` (группы `nuxt`, `b24`, `dev-deps`, actions, docker).

## 4. Пакет GHCR

Первый push в `main` после выката (джоба `deploy`) создаст пакет `ghcr.io/bx-shef/invoice-from-tasks`.
Сделать его публичным: github.com/orgs/bx-shef/packages → `invoice-from-tasks` → Package settings →
Change visibility → Public. Тогда серверу и Watchtower не нужен `docker login` (`docs/DEPLOY.md`).

Проверка: `docker pull ghcr.io/bx-shef/invoice-from-tasks:latest` без логина проходит.

## 5. Жизненный цикл изменения

ветка от `main` → код + тесты + документация одним PR → `/code-review` + панель из пяти →
исправления в том же PR → зелёный `ci` → squash-мерж → удаление ветки → комментарий в issue.
Подробно — `docs/AGENT_RULES.md`.
