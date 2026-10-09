// Выбор полей клиента в настройках (#34): пункты выпадающего списка и подстановка созданных полей.
// Чистые функции для SettingsClientFields.vue.

import { APP_FIELDS, INVOICE_APPROVED_AT_FIELD, INVOICE_APPROVED_FIELD, INVOICE_ECONOMICS_FIELD, INVOICE_QR_FIELD, TASK_DELTA_FIELD, TASK_DIFF_PERCENT_FIELD, TASK_WORK_COST_FIELD, type UserFieldOption } from '#shared/domain/userFields'
import type { AppSettings } from '#shared/domain/settings'

/** Пункт списка: «Подпись (UF_CODE)»; `value: ''` — «Не выбрано». */
export interface FieldItem {
  label: string
  value: string
}

/**
 * Пункты выпадающего списка. Сохранённое поле, которого нет в портале (удалили или список не
 * прочитался), остаётся пунктом с пометкой: иначе список показал бы пусто и администратор не понял
 * бы, что настройка указывает в никуда.
 */
export function fieldItems(fields: UserFieldOption[] | null, saved: string): FieldItem[] {
  const items: FieldItem[] = [{ label: 'Не выбрано', value: '' }]
  for (const f of fields ?? []) items.push({ label: f.label === f.name ? f.name : `${f.label} (${f.name})`, value: f.name })
  if (saved && !items.some(i => i.value === saved)) {
    items.push({ label: fields ? `${saved} — нет в портале` : saved, value: saved })
  }
  return items
}

/** Какой ключ настроек заполняет поле приложения (по коду поля). */
const SETTING_OF: Record<string, keyof AppSettings['clientFields']> = {
  UF_SH_IFT_CLIENT_TASK: 'task',
  UF_SH_IFT_CLIENT_DOMAIN: 'taskDomain'
}

/**
 * После «Создать поля»: невыбранные настройки получают поля приложения (созданные сейчас или уже
 * существующие). Выбранное администратором другое поле не трогаем.
 */
/** Поля счёта приложения → ключ настроек публичной страницы. */
const PUBLIC_SETTING_OF: Record<string, 'qrField' | 'approvedField' | 'approvedAtField'> = {
  [INVOICE_QR_FIELD]: 'qrField',
  [INVOICE_APPROVED_FIELD]: 'approvedField',
  [INVOICE_APPROVED_AT_FIELD]: 'approvedAtField'
}

/** То же для полей счёта: невыбранные настройки публичной страницы получают поля приложения. */
export function withAppInvoiceFields(page: AppSettings['publicPage']): AppSettings['publicPage'] {
  const next = { ...page }
  for (const [name, key] of Object.entries(PUBLIC_SETTING_OF)) if (!next[key]) next[key] = name
  return next
}

/**
 * После «Создать поля»: поля экономики задачи и «Экономика счёта» — в настройки, если там пусто
 * (своё поле «Стоимость работ», выбранное администратором, не трогаем).
 */
export function withAppEconomyFields(settings: Pick<AppSettings, 'taskFields' | 'economics'>): Pick<AppSettings, 'taskFields' | 'economics'> {
  const f = settings.taskFields
  return {
    taskFields: {
      workCost: f.workCost || TASK_WORK_COST_FIELD,
      diffPercent: f.diffPercent || TASK_DIFF_PERCENT_FIELD,
      delta: f.delta || TASK_DELTA_FIELD
    },
    economics: { ...settings.economics, invoiceField: settings.economics.invoiceField || INVOICE_ECONOMICS_FIELD }
  }
}

export function withAppFields(fields: AppSettings['clientFields']): AppSettings['clientFields'] {
  const next = { ...fields }
  // Поля своих типов (код доступа, вебхук) в настройки не выбираются — только поля задачи.
  for (const spec of APP_FIELDS) {
    const key = SETTING_OF[spec.name]
    if (key && !next[key]) next[key] = spec.name
  }
  return next
}
