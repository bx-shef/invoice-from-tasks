// Выбор полей клиента в настройках (#34): пункты выпадающего списка и подстановка созданных полей.
// Чистые функции для SettingsClientFields.vue.

import { APP_FIELDS, type UserFieldOption } from '#shared/domain/userFields'
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
export function withAppFields(fields: AppSettings['clientFields']): AppSettings['clientFields'] {
  const next = { ...fields }
  // Поля своих типов (код доступа, вебхук) в настройки не выбираются — только поля задачи.
  for (const spec of APP_FIELDS) {
    const key = SETTING_OF[spec.name]
    if (key && !next[key]) next[key] = spec.name
  }
  return next
}
