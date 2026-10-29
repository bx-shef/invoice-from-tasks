/**
 * Готовность портала для главной (дизайн v2): чек-лист по реальным настройкам со ссылкой в нужный
 * раздел. `ok: false` у обязательного пункта — счёт не заполнится; у необязательного — подсказка.
 */
import type { AppSettings } from '#shared/domain/settings'
import type { SettingsSection } from './settingsNav'

export interface ReadinessItem {
  key: string
  ok: boolean
  /** Без него счёт не заполнится. */
  required: boolean
  text: string
  section: SettingsSection
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
}

export function readiness(settings: AppSettings, rates: ReadonlyArray<{ userId: number, client?: string }>): ReadinessItem[] {
  const people = new Set(rates.map(r => r.userId)).size
  const clientRates = rates.filter(r => r.client).length
  const stages = settings.publicPage.stages.length
  return [
    {
      key: 'rates',
      ok: Boolean(settings.currency) && people > 0,
      required: true,
      text: !settings.currency
        ? 'Не выбрана валюта ставок'
        : people
          ? `Ставки: ${people} ${plural(people, 'сотрудник', 'сотрудника', 'сотрудников')}${clientRates ? `, клиентских ${clientRates}` : ''} · ${settings.currency}`
          : 'Ставок нет — счёт не посчитать',
      section: settings.currency ? 'rates' : 'general'
    },
    {
      key: 'vat',
      ok: settings.vat.length > 0,
      required: true,
      text: settings.vat.length
        ? `НДС задан (реквизитов вашей компании: ${settings.vat.length})`
        : 'НДС не задан ни для одних реквизитов',
      section: 'vat'
    },
    {
      key: 'clientFields',
      ok: Boolean(settings.clientFields.task),
      required: false,
      text: settings.clientFields.task ? 'Поле задачи клиента выбрано' : 'Поле задачи клиента не выбрано',
      section: 'clientFields'
    },
    {
      key: 'publicPage',
      ok: stages > 0,
      required: false,
      text: stages
        ? `Публичная страница: ${stages} ${plural(stages, 'стадия', 'стадии', 'стадий')}${settings.publicPage.approvalStage ? ', есть согласование' : ''}`
        : 'Публичная страница выключена',
      section: 'publicPage'
    },
    {
      key: 'access',
      ok: true,
      required: false,
      text: settings.rateEditors.length
        ? `Ставки меняют ещё ${settings.rateEditors.length} ${plural(settings.rateEditors.length, 'сотрудник', 'сотрудника', 'сотрудников')} кроме админов`
        : 'Ставки меняют только администраторы',
      section: 'access'
    }
  ]
}
