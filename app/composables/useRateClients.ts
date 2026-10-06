// Клиенты ставок: названия по кодам (кэш на время страницы) и выбор штатным диалогом CRM
// ($b24.dialog.selectCRM — документация DialogManager в b24jssdk). Разбор — app/utils/rateClients.ts.

import { clientLabel, clientNamesCalls, parseClientNames, pickedClient } from '~/utils/rateClients'

export function useRateClients() {
  const b24 = useB24()
  const names = useState<Record<string, string>>('rate-client-names', () => ({}))

  /** Подгружает названия недостающих клиентов. Сбой не страшен — покажем «Компания #ID». */
  async function load(codes: string[]): Promise<void> {
    const calls = clientNamesCalls(codes.filter(code => !names.value[code]))
    if (!calls.length) return
    try {
      const results = await Promise.all(calls.map(c => b24.call(c.method, c.params)))
      const next = { ...names.value }
      results.forEach((res, i) => Object.assign(next, parseClientNames(calls[i]!, res)))
      names.value = next
    } catch {
      // Названия — удобство; без них форма работает на кодах.
    }
  }

  function label(code: string): string {
    return clientLabel(code, names.value)
  }

  async function pickOne(): Promise<string | null> {
    const picked = pickedClient(await b24.getOrThrow().dialog.selectCRM({ entityType: ['company', 'contact'], multiple: false }))
    if (!picked) return null
    names.value = { ...names.value, [picked.code]: picked.title }
    return picked.code
  }

  return { load, label, pickOne }
}
