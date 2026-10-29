/** Разделы настроек — боковым меню из 4 групп (дизайн v2): Расчёт · Клиент · ИИ · Система. */
export type SettingsSection = 'general' | 'rates' | 'markup' | 'vat' | 'clientFields' | 'publicPage' | 'prompts' | 'access' | 'storage'

export interface SettingsGroup {
  title: string
  items: ReadonlyArray<{ value: SettingsSection, label: string }>
}

export const SETTINGS_GROUPS: ReadonlyArray<SettingsGroup> = [
  { title: 'Расчёт', items: [{ value: 'general', label: 'Общие' }, { value: 'rates', label: 'Ставки' }, { value: 'markup', label: 'Наценки' }, { value: 'vat', label: 'НДС' }] },
  { title: 'Клиент', items: [{ value: 'clientFields', label: 'Поля клиента' }, { value: 'publicPage', label: 'Публичная страница' }] },
  { title: 'ИИ', items: [{ value: 'prompts', label: 'Промпты' }] },
  { title: 'Система', items: [{ value: 'access', label: 'Доступ' }, { value: 'storage', label: 'Хранилище' }] }
]

/** Не-админу (редактору ставок) — только «Ставки». */
export function settingsGroupsFor(isAdmin: boolean): ReadonlyArray<SettingsGroup> {
  if (isAdmin) return SETTINGS_GROUPS
  return SETTINGS_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => i.value === 'rates') }))
    .filter(g => g.items.length)
}

/** Какой раздел показать: не-админ всегда видит «Ставки», что бы ни было выбрано. */
export function effectiveSection(selected: SettingsSection, isAdmin: boolean): SettingsSection {
  return isAdmin ? selected : 'rates'
}
