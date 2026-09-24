# Исходящие вызовы REST Битрикс24

> Last reviewed: 2026-09-24

Реестр каждого метода, который зовёт приложение. Добавили вызов в код — добавьте строку сюда:
`tests/repoGuards.test.ts` сверяет строковые имена методов в `app/`, `server/`, `shared/` с этим
файлом и краснеет на пропуске. Из этого же списка собирается набор прав приложения.

Сигнатуры здесь не дублируются: их источник — MCP `b24-dev-mcp` (`bitrix-search` →
`bitrix-method-details`). Здесь — то, чего в документации нет: кто зовёт, каким транспортом, чьими
правами и на какие грабли уже наступили.

**Транспорт.** «Фрейм» — `@bitrix24/b24jssdk` во фрейме портала (`app/composables/useB24.ts`),
правами сотрудника, открывшего страницу. «Сервер: фрейм-токен» — наш Nitro зовёт портал токеном
того же сотрудника (`server/utils/b24Client.ts → makeFrameCall`). «Сервер: установщик» — токеном
администратора, установившего приложение (`makePortalCall`), только там, где прав сотрудника не
хватает по документации.

**Статус.** 📄 — сверено с документацией MCP, на живом портале НЕ проверялось; ✅ — проверено
вживую (пока таких нет — см. `docs/project-map.md`).

## Счёт и товарные позиции (право `crm`)

| Метод | Транспорт | Файл | Назначение, грабли | Статус |
|---|---|---|---|---|
| `crm.item.get` | фрейм | `useInvoiceFill.ts` | Счёт: `entityTypeId = 31`. Сделка — в `parentId2`, валюта — `currencyId`. | 📄 |
| `crm.item.productrow.list` | фрейм | `useInvoiceFill.ts` | Существующие позиции: фильтр `=ownerType: 'SI'`, `=ownerId`. | 📄 |
| `crm.item.productrow.set` | фрейм | `useInvoiceFill.ts` | Режим «заменить»: ЗАМЕНЯЕТ все позиции переданным набором. | 📄 |
| `crm.item.productrow.add` | фрейм, batch | `useInvoiceFill.ts` | Режим «добавить»: по одной позиции, остальные не трогает. ⚠ `set` для этого не годится: у позиции без переданной цены цена станет 0 (документация `set`). | 📄 |
| `crm.currency.list` | фрейм | `SettingsGeneral.vue` | Список валют для «валюты ставок»: `CURRENCY`, `FULL_NAME`. | 📄 |
| `crm.activity.todo.add` | фрейм | `useInvoiceFill.ts`, параметры — `shared/domain/activity.ts` | Ответ консультации делом в счёте (`ownerTypeId = 31`). Схема — как в ai-price-import (там проверено вживую). | 📄 |
| `crm.activity.update` | фрейм | `useInvoiceFill.ts` | Сразу после `todo.add`: `DESCRIPTION_TYPE = 3` (BB), иначе переносы строк ответа слипаются. У `todo.add` такого параметра нет. Метод помечен устаревшим, но другого пути нет — так делает и ai-price-import. | 📄 |

## Задачи (право `task`)

| Метод | Транспорт | Файл | Назначение, грабли | Статус |
|---|---|---|---|---|
| `tasks.task.list` | фрейм, `callList` | `useInvoiceFill.ts` | Задачи по привязке `UF_CRM_TASK`. ⚠ Фильтр — ОБЪЕКТОМ (`{ UF_CRM_TASK: 'D_5' }`): MCP показывает форму REST v3 (массив), а `/rest/` её отвергает с 400 — замер get-task-from-b24. ⚠ Непонятый фильтр портал НЕ отвергает, а отдаёт все задачи: привязку перепроверяем сами (`shared/domain/tasks.ts → tasksBoundTo`). Ответ — `{ tasks: [...] }`, ключи camelCase, числа строками. `callList`: `idKey: 'id'`, `cursorIdKey: 'ID'`. | 📄 |
| `task.elapseditem.getlist` | фрейм | `useInvoiceFill.ts` | Записи затраченного времени задачи. ⚠ Параметры ПОЗИЦИОННЫЕ, массивом: `[taskId, order, filter, select, params]` — как в примере документации. Страница — не больше 50 (`NAV_PARAMS.nPageSize`), листаем по `total`. Ключи UPPER_CASE: `USER_ID`, `SECONDS`, `COMMENT_TEXT`, `DATE_START`, `CREATED_DATE`. | 📄 |
| `tasks.task.result.list` | фрейм | `useInvoiceFill.ts` | Отчёты задачи — контекст названий в режиме BitrixGPT (тип 1). Сбой не останавливает заполнение. ⚠ В MCP описан вариант REST v3; какой ответ даст `/rest/`, не проверено — поэтому вызов необязательный. | 📄 |

⚠ **Право называется `task`**, хотя страницы `tasks.task.*` пишут `tasks`: документация
противоречит сама себе, живой портал принял `task` (замер get-task-from-b24, 2026-08-26).

⚠ **Код привязки задачи к счёту не подтверждён.** Для сделки — `D_<id>` (документация). Для
нового счёта ищем и по `SI_<id>`, и по `T1f_<id>` (31 = 0x1f) — см. `crmBindingCodes`.

## Каталог (право `catalog`)

| Метод | Транспорт | Файл | Назначение, грабли | Статус |
|---|---|---|---|---|
| `catalog.catalog.list` | фрейм | `useCatalog.ts` | Инфоблоки товарных каталогов. Каталог предложений (с `productIblockId`) пропускаем. | 📄 |
| `catalog.product.list` | фрейм | `useCatalog.ts` | Поиск товара по названию (`%name`), `iblockId` обязателен. | 📄 |
| `catalog.product.get` | фрейм | `useCatalog.ts`, `useInvoiceFill.ts` | Название товара и его папка `iblockSectionId` — для наценки по папке. | 📄 |
| `catalog.section.list` | фрейм | `useCatalog.ts` | Поиск папки по названию, `iblockId` обязателен. | 📄 |
| `catalog.section.get` | фрейм | `useInvoiceFill.ts` | Родитель папки (`iblockSectionId`) — подъём по дереву для наценки. | 📄 |
| `catalog.measure.list` | фрейм | `useCatalog.ts` | Единицы измерения для строк: `code`, `measureTitle`. | 📄 |

## Сотрудники (право `user_brief`)

| Метод | Транспорт | Файл | Назначение, грабли | Статус |
|---|---|---|---|---|
| `user.get` | фрейм, batch | `useUsers.ts` | Имена сотрудников для ставок, ошибок и предпросмотра. Сбой не критичен — показываем `#ID`. | 📄 |

## Настройки приложения (базовое право)

| Метод | Транспорт | Файл | Назначение, грабли | Статус |
|---|---|---|---|---|
| `app.option.get` | фрейм; сервер: фрейм-токен | `useAppSettings.ts`, `server/utils/options.ts` | Чтение настроек и ставок. Доступно любому сотруднику. Без `option` — все опции (нужно для подсчёта места). | 📄 |
| `app.option.set` | сервер: фрейм-токен (админ) / установщик (редактор ставок) | `server/api/settings.post.ts`, `server/api/rates.post.ts` | ⚠ **Только администратор** («Administrator authorization required» — документация). Поэтому не-администратора из списка редакторов ставок сервер пишет токеном установщика. Размер не документирован — см. `docs/SETTINGS.md`. | 📄 |
| `app.info` | сервер: фрейм-токен | `server/utils/frameAuth.ts` | `CODE` — принадлежит ли фрейм-токен нашему приложению (если задан `B24_APP_CODE`). | 📄 |
| `profile` | фрейм; сервер: фрейм-токен | `useAppSettings.ts`, `server/utils/frameAuth.ts` | Кто пришёл: `ID`, `ADMIN`. Этим флагом сервер решает, пускать ли к записи настроек. | 📄 |
| `scope` | фрейм | `pages/install.vue` | Какие права выданы — установка показывает недостающие. | 📄 |

## Встройки и события (право `placement`, базовое)

| Метод | Транспорт | Файл | Назначение, грабли | Статус |
|---|---|---|---|---|
| `placement.get` | фрейм | `pages/install.vue` | Что уже зарегистрировано: переустановка не должна дать второй пункт меню (точка допускает несколько регистраций). | 📄 |
| `placement.bind` | фрейм | `pages/install.vue`, параметры — `app/utils/install.ts` | `CRM_SMART_INVOICE_DETAIL_TOOLBAR` → `/invoice`. Только из контекста приложения (вебхуком нельзя). `OPTIONS` точка не поддерживает. Пункт не виден до `installFinish`. | 📄 |
| `placement.unbind` | фрейм | `pages/install.vue` | Снять встройку со старым адресом (переезд сервера). | 📄 |
| `event.get` | фрейм | `pages/install.vue` | Уже оформленные подписки — чтобы не дублировать. | 📄 |
| `event.bind` | фрейм | `pages/install.vue` | `ONAPPINSTALL` / `ONAPPUNINSTALL` → `/api/b24/events`. ⚠ До `installFinish`, иначе установка не придёт. | 📄 |

## Не REST, но рядом

- `$b24.installFinish()`, `$b24.parent.setTitle()`, `$b24.dialog.selectUser(s)()`,
  `$b24.placement.options` — методы фрейма b24jssdk (документация: `https://bitrix24.github.io/b24jssdk/llms.txt`).
- `https://oauth.bitrix.info/oauth/token/` — обновление токена при установке для сверки member_id
  (`server/utils/verifyInstallMember.ts`); хост фиксированный.
- `https://vibecode.bitrix24.tech/v1` — BitrixGPT (OpenAI-совместимый AI Router Вайбкода), `server/utils/llm.ts`.
