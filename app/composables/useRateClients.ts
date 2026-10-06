// Клиенты ставок: названия по кодам (кэш на время страницы) и выбор штатным диалогом CRM
// ($b24.dialog.selectCRM — документация DialogManager в b24jssdk). Разбор — app/utils/rateClients.ts.

import { clientLabel, clientNamesCalls, parseClientNames, pickedClient } from '~/utils/rateClients'

/**
 * Названия и выбор клиентов ставок. Названия кэшируются на время страницы: переименование
 * клиента в CRM видно после перезагрузки настроек.
 */
export function useRateClients() {
  const b24 = useB24()
  const names = useState<Record<string, string>>('rate-client-names', () => ({}))

  /** Подгружает названия недостающих клиентов. Сбой не страшен — покажем «Компания #ID». */
  async function load(codes: string[]): Promise<void> {
    const calls = clientNamesCalls(codes.filter(code => !names.value[code]))
    if (!calls.length) return
    // allSettled: нет доступа к контактам — названия компаний всё равно показываем.
    // Сбой — не ошибка: названия — удобство, без них форма работает на «Компания #ID».
    const results = await Promise.allSettled(calls.map(c => b24.call(c.method, c.params)))
    const next = { ...names.value }
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') Object.assign(next, parseClientNames(calls[i]!, res.value))
    })
    names.value = next
  }

  /** Подпись клиента: название или «Компания #ID» / «Контакт #ID». */
  function label(code: string): string {
    return clientLabel(code, names.value)
  }

  /** Диалог выбора компании или контакта; код клиента или `null`, если ничего не выбрали. */
  async function pickOne(): Promise<string | null> {
    const picked = pickedClient(await b24.getOrThrow().dialog.selectCRM({ entityType: ['company', 'contact'], multiple: false }))
    if (!picked) return null
    names.value = { ...names.value, [picked.code]: picked.title }
    return picked.code
  }

  return { load, label, pickOne }
}
