// Константы интеграции с Битрикс24: права, встройки, события. Одно место — чтобы установка,
// документация (docs/B24_EVENTS.md, docs/REST_METHODS.md) и код не разъехались.

/**
 * Права (scope) приложения — задаются в карточке приложения в портале.
 * ⚠ Право задач называется `task`, хотя страницы tasks.task.* в документации пишут `tasks`:
 * документация противоречит сама себе, а живой портал принял `task` (замер соседнего
 * get-task-from-b24 от 2026-08-26, их docs/CLIENT_APP.md). Страница установки сверяет список
 * с методом `scope` и показывает, чего не хватает.
 */
export const B24_REQUIRED_SCOPES = ['crm', 'task', 'catalog', 'user_brief', 'placement'] as const

/** Встройка: пункт меню верхней кнопки карточки нового счёта (документация CRM_XXX_DETAIL_TOOLBAR). */
export const INVOICE_PLACEMENT = 'CRM_SMART_INVOICE_DETAIL_TOOLBAR'
export const INVOICE_PLACEMENT_TITLE = 'Заполнить из задач'

/** Путь страницы-обработчика встройки. */
export const INVOICE_HANDLER_PATH = '/invoice'

/** События, на которые подписываемся при установке (обработчик — /api/b24/events). */
export const BOUND_EVENTS = ['ONAPPINSTALL', 'ONAPPUNINSTALL'] as const
export const EVENTS_HANDLER_PATH = '/api/b24/events'
