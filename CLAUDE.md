# CLAUDE.md

> Last reviewed: 2026-09-24

Приложение Битрикс24 «Счёт из задач»: заполняет товарную часть нового счёта (CRM, тип 31) по
задачам — из связанной сделки или привязанным к счёту — и затраченному в них времени. Ставки
сотрудников, округление, наценки и промпты BitrixGPT — в настройках приложения.

**Правила процесса — [`docs/AGENT_RULES.md`](docs/AGENT_RULES.md): они главнее этого файла.**
Коротко: в `main` только через PR; собрал или доработал PR — `/code-review` и панель из пяти
(навык `review-panel`); мерж — по навыку `merge-pr`.

Этот файл — карта и конвенции. Держим коротким (эталонный разросся до полумегабайта и
перестал читаться): журналы, замеры и история — в `docs/`.

## Команды

```bash
pnpm install          # + nuxt prepare (postinstall)
pnpm dev              # разработка; страницы работают только во фрейме портала
pnpm check            # lint + typecheck + test — перед каждым PR
pnpm build            # сборка сервера .output/server/index.mjs
```

## Карта

| Где | Что |
|---|---|
| `shared/domain/` | **чистые правила**: `time` (округление), `rates` (ставки по датам), `markup` (наценки), `fill` (сборка строк, тип 1/2), `tasks` (разбор задач и времени, привязка к CRM), `invoice`, `settings` (формат настроек), `storageBudget` (место в app.option), `prompts` (BitrixGPT), `activity` (дело консультации) |
| `app/pages/` | `index` (публичная), `install` (установка), `app` (главная в портале), `settings`, `invoice` (встройка в карточку счёта) |
| `app/composables/` | `useB24` (фрейм и REST), `useApi` (наш /api с фрейм-токеном), `useAppSettings`, `useInvoiceFill` (сценарий счёта), `useCatalog`, `useUsers`, `useStorageProbe` |
| `app/utils/` | `install` (шаги установки), `placement` (ID счёта из встройки), `storageProbe` (замер места), `frameToken` |
| `app/config/b24.ts` | права, встройка, события — одно место |
| `server/api/` | `b24/events` (установка/удаление), `settings`, `rates`, `ai/names`, `ai/consult`, `health` |
| `server/utils/` | `frameAuth` (кто пришёл), `b24Host` (SSRF-гард, CSP), `b24Client` (REST через B24OAuth), `tokenStore` + `secretCrypto` (токены установки), `verifyInstallMember`, `llm` + `aiGateway` + `rateLimit` (BitrixGPT) |
| `tests/` | юнит-тесты (vitest, node); `tests/server/` — серверные модули; `repoGuards` — гарды репо |

Подробно: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), правила расчёта —
[`docs/PROCESSING.md`](docs/PROCESSING.md).

## Конвенции

- **По Битрикс24 не гадаем — читаем.** REST — MCP `b24-dev-mcp`; b24jssdk и b24ui — их `llms.txt`
  (навык `b24-docs`). Документация задаёт форму запроса, живой портал подтверждает результат.
  Уже пойманные расхождения — в `docs/REST_METHODS.md` (фильтр задач объектом, право `task`,
  позиционные параметры `task.elapseditem.getlist`, `keepAuthFresh` нет в SDK 2.2.0).
- **Добавил REST-метод — строка в `docs/REST_METHODS.md`.** Иначе краснеет `tests/repoGuards.test.ts`.
- **Чистые функции отдельно**, с тестами; REST и запись — тонким слоем поверх. Серверные модули
  с автоимпортами Nitro (`useStorage`, `createError`) — только в обработчиках и `requestContext.ts`,
  чтобы чистые модули импортировались в тестах.
- **Если в задаче чего-то не хватает — стоп**: собрать все проблемы, ничего не писать в счёт.
- **Права CRM не расширяем**: товары в счёт пишет сотрудник своими правами из фрейма. Токен
  установщика — только для записи ставок редактором.
- **Секреты — только окружением** (`.env.example`). Токены, ключи и тексты задач в журнал не пишем.
- **Язык** — по таблице `docs/AGENT_RULES.md` §0: код по-английски, комментарии, документация,
  коммиты и PR — по-русски, follow-up issues — по-английски.
- **Штамп `> Last reviewed: YYYY-MM-DD`** под заголовком каждого `.md`.
- **Тест должен краснеть при мутации кода** (`AGENT_RULES.md` §5.2); откат мутации — из копии,
  не `git checkout --`.
