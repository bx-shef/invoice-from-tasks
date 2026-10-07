# CLAUDE.md

> Last reviewed: 2026-10-07

Приложение Битрикс24 «Счёт из задач»: заполняет товарную часть нового счёта (CRM, тип 31) по
задачам — из связанной сделки или привязанным к счёту — и затраченному в них времени. Ставки
сотрудников, округление, наценки по тегам задач и промпты BitrixGPT — в настройках приложения.

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
pnpm smoke            # живой прогон на ТЕСТОВОМ портале: REST, расчёт, запись, BitrixGPT (docs/SMOKE.md)
```

## Карта

| Где | Что |
|---|---|
| `shared/domain/` | **чистые правила**: `time` (округление), `rates` (ставки по датам и клиентам), `markup` (наценки по тегам), `currency` (пересчёт по курсу портала), `vat` (НДС по «Реквизитам вашей компании»), `money` (копейки как у портала), `fill` (сборка строк, тип 1/2, цена часа или сумма × 1), `tasks` (разбор задач и времени, привязка к CRM), `invoice`, `settings` (формат настроек), `storageBudget` (место в app.option), `prompts` (BitrixGPT), `userFields` (поля клиента: коды UF, поля приложения), `appFieldTypes` (свои типы полей: код доступа, вебхук клиента), `publicInvoice` (публичная страница счёта: разбор и сборка), `invoiceLinks` (адреса расшифровки и QR, поля счёта для них), `approval` (режим согласования: комментарии-дела, отметка), `kb` (справка: страницы docs/guide, поиск BM25, промпт ИИ-чата), `economics` (формула против выставленного: дельта, разница %, пометки, «Экономика счёта»), `estimate` (оценка часов ИИ для задач без времени), `answer` (разбор ответа модели — общий для ленты и окна), `activity` (запись консультации в ленте) |
| `app/pages/` | `index` (публичная), `install` (установка), `app` (главная в портале), `settings`, `invoice` (встройка в карточку счёта), `help` (справка и ИИ-чат), `uf/access-code`, `uf/client-hook` и `uf/economics` (поля своих типов в карточках компании, контакта и счёта), `p-[domain]/i-[id]` (публичная страница счёта по коду) |
| `app/composables/` | `useB24` (фрейм и REST v2/v3), `useApi` (наш /api с фрейм-токеном), `useAppSettings`, `useInvoiceFill` (сценарий счёта), `useCatalog` (единицы измерения, ставки НДС), `useRateClients` (клиенты ставок), `useUserFields` (списки UF и создание полей приложения), `useFieldWriter` (запись значения поля своего типа), `useInvoiceStages` (стадии счёта), `useMyCompanies` (реквизиты вашей компании), `useInvoiceLinks` (ссылки расшифровки и QR в поля счёта), `useChats` (выбор чата проблем), `useHelpChat` (ИИ-чат справки: открыт, вопрос, обсуждаемая страница), `useUsers`, `useStorageProbe` |
| `app/utils/` | `install` (шаги установки), `placement` (ID счёта из встройки), `storageProbe` (замер места), `frameToken`, `concurrency` (параллельные чтения с ограничением), `paging` (сбор страниц), `b24Batch` (ошибки REST, разбор пакета), `writeOutcome` (итог записи в счёт), `writeConfirm` (вопросы перед записью), `serverHealth` (что не настроено на сервере), `measures` (единицы измерения: справочник, ОКЕИ, какая единица ляжет в строки), `vatSettings` (выбор НДС в настройках), `invoiceRequests` (параметры REST-запросов сценария счёта), `fillPreview` (столбцы и подписи предпросмотра), `rateClients` (коды и названия клиентов ставок), `userFieldRequests` (запросы UF), `clientFieldSettings` (выбор полей клиента), `fieldPlacement` (контекст поля своего типа и как его записать), `invoiceStages` (стадии счёта, адрес публичной страницы), `chatOptions` (чаты для выбора), `help` (слайдер справки по `place`, markdown), `helpLayout` (оглавление, поиск и соседи страниц справки) |
| `app/config/b24.ts` | права, встройка, события, настройки SDK (без автоповторов записи) — одно место |
| `server/api/` | тонкие обёртки: `b24/events` (установка/удаление), `settings`, `rates`, `ai/names`, `ai/consult`, `ai/estimate`, `client-hook/seal` (шифрование вебхука клиента), `public/invoice`, `public/document`, `public/comment`, `public/approve` (публичная страница счёта, PDF, комментарии и согласование — без фрейма, по коду), `kb/pages`, `kb/chat` (справка и ИИ-чат по ней), `health` (флаги настроек и коммит сборки); `server/routes/qr/` — PNG с QR-кодом страницы счёта для шаблонов документов |
| `server/middleware/` | `securityHeaders` (CSP для фрейма), `requestLimits` (размер тела) |
| `server/utils/` | `frameAuth` (кто пришёл), `requestContext` (обвязка обработчиков, IP), `b24Host` (SSRF-гард, CSP, серверы авторизации), `b24Client` (REST через B24OAuth), `b24Events` (разбор события) + `b24EventsHandler` (решение по событию), `verifyInstallMember` (сверка member_id и домена), `tokenStore` + `secretCrypto` (токены установки), `clientHook` (вебхук клиента: проверка, шифрование своим ключом), `publicInvoice` (решение публичной страницы: лимиты, код, токен установщика), `clientPortal` (задачи клиента по его вебхуку: https, без редиректов, таймаут), `publicContext` (общие лимиты, кеш и доступ публичных обработчиков), `installerCall` (токен установщика: свежая запись, очередь), `options` (app.option с бюджетом) + `optionWrites` (кто и каким токеном пишет), `requestLimits` (пределы, IP за прокси), `buildInfo` (коммит сборки для health), `llm` + `aiGateway` + `aiRequests` + `rateLimit` (BitrixGPT, лимиты) |
| `tests/` | юнит-тесты (vitest, node); `tests/server/` — серверные модули; `repoGuards` — гарды репо |
| `docker-compose.prod.yml`, `Makefile` | выкат как в client-bank: `main` → GHCR → Watchtower → nginx-proxy, `invoice-from-tasks.bx-shef.by`; проверка сервера — `make doctor` — `docs/DEPLOY.md` |
| `smoke/` | смок на тестовом портале (`pnpm smoke`, свой vitest-конфиг, не в CI): страж портала, засев, формы REST, матрица расчёта, BitrixGPT — `docs/SMOKE.md` |

**Документация двух видов**: `docs/guide/NN-*.md` — публичная справка (страница «Справка», ИИ-чат,
подсказки «Что это значит?» → `docs/guide/90-faq.md` с якорями `{#id}`); остальное в `docs/` —
внутреннее, на справку и в чат не попадает.

Подробно: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), правила расчёта —
[`docs/PROCESSING.md`](docs/PROCESSING.md).

## Конвенции

- **По Битрикс24 не гадаем — читаем.** REST — MCP `b24-dev-mcp`; b24jssdk и b24ui — их `llms.txt`
  (навык `b24-docs`). Документация задаёт форму запроса, живой портал подтверждает результат.
  Работаем через b24jssdk; метод есть в REST v3 — зовём v3 (`b24.callV3`), иначе v2; исключения
  владельца — в `docs/REST_METHODS.md` («Версия REST»: теги задач из v2-списка, #13). Параметры
  запросов сценария счёта — только в `app/utils/invoiceRequests.ts` (их же шлёт смок).
  Уже пойманные расхождения — в `docs/REST_METHODS.md` (фильтр задач объектом, право `task`,
  позиционные параметры `task.elapseditem.getlist`, дело консультации — только из приложения, сервер авторизации
  `oauth.bitrix24.tech`, `keepAuthFresh` нет в SDK 2.2.0, `price` строки — с налогом).
- **Добавил REST-метод — строка в `docs/REST_METHODS.md`.** Иначе краснеет `tests/repoGuards.test.ts`.
- **Чистые функции отдельно**, с тестами; REST и запись — тонким слоем поверх. Серверные модули
  с автоимпортами Nitro (`useStorage`, `createError`) — только в обработчиках, `server/middleware/`
  и `requestContext.ts`, чтобы чистые модули импортировались в тестах. Решение обработчика —
  в чистом модуле с внедряемыми зависимостями (`b24EventsHandler`, `optionWrites`, `aiRequests`,
  `installerCall`); на клиенте — так же (`app/utils/paging`, `writeOutcome`, `b24Batch`).
- **Если в задаче чего-то не хватает — стоп**: собрать все проблемы, ничего не писать в счёт.
  Исключение — задача без затраченного времени (планирование, решение владельца 2026-10-07):
  предупреждение, часы оценивает ИИ (`shared/domain/estimate.ts`), запись разрешена.
- **Права CRM не расширяем**: товары в счёт пишет сотрудник своими правами из фрейма. Токен
  установщика — только для записи ставок редактором, чтения на публичной странице счёта по
  верному коду (#34, `server/utils/publicInvoice.ts`) и, в стадии согласования, комментария клиента
  и отметки «Согласовано» (дело и поля счёта), а также сообщений в чат проблем.
- **Секреты — только окружением** (`.env.example`). Токены, ключи и тексты задач в журнал не пишем.
- **Язык** — по таблице `docs/AGENT_RULES.md` §0: код по-английски; комментарии, документация,
  коммиты, PR и issues — по-русски.
- **Штамп `> Last reviewed: YYYY-MM-DD`** под заголовком каждого `.md`.
- **Компоненты из подкаталогов — с приставкой каталога**: `components/invoice/FillPreview.vue` —
  тег `<InvoiceFillPreview>`. Незнакомый тег Vue рисует пустым без ошибки; ловит `pnpm typecheck`
  (`checkUnknownComponents` в `tsconfig.json`).
- **Тест должен краснеть при мутации кода** (`AGENT_RULES.md` §5.2); откат мутации — из копии,
  не `git checkout --`.
