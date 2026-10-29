/**
 * Общая панель сохранения настроек: что изменено, что можно сохранить сейчас и почему остальное нет.
 * Настройки и ставки независимы: ошибка в одном не мешает сохранить другое.
 */
export interface SaveBarInput {
  isAdmin: boolean
  settingsDirty: boolean
  /** Почему настройки не сохранить ('' — можно). */
  settingsBlocked: string
  ratesDirty: boolean
  ratesBlocked: string
}

export interface SavePlan {
  changed: string[]
  saveSettings: boolean
  saveRates: boolean
  /** Причины, по которым часть изменений не сохранится. */
  blocked: string[]
}

export function planSave(i: SaveBarInput): SavePlan {
  const settings = i.isAdmin && i.settingsDirty
  const changed = [settings ? 'настройки' : '', i.ratesDirty ? 'ставки' : ''].filter(Boolean)
  const blocked = [
    settings && i.settingsBlocked ? `настройки: ${i.settingsBlocked}` : '',
    i.ratesDirty && i.ratesBlocked ? `ставки: ${i.ratesBlocked}` : ''
  ].filter(Boolean)
  return {
    changed,
    saveSettings: settings && !i.settingsBlocked,
    saveRates: i.ratesDirty && !i.ratesBlocked,
    blocked
  }
}

/** Итог сохранения для тоста: что записалось и что нет. */
export function saveSummary(saved: string[], failed: string[]): { ok: boolean, title: string, description?: string } {
  if (!failed.length) return { ok: true, title: `Сохранено: ${saved.join(', ')}` }
  return {
    ok: false,
    title: 'Не всё сохранилось',
    description: [saved.length ? `Сохранено: ${saved.join(', ')}.` : '', `Ошибка — ${failed.join('; ')}`].filter(Boolean).join(' ')
  }
}
