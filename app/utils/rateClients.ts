// Клиенты ставок (компания `CO_<id>`, контакт `C_<id>`): запрос названий и разбор ответов —
// чистые функции для useRateClients.ts. Метод и форма — docs/REST_METHODS.md (`crm.item.list`).

import type { SelectedCRM } from '@bitrix24/b24jssdk'
import { isRateClient } from '#shared/domain/rates'
import type { RestCall } from './invoiceRequests'

/** Тип объекта CRM: контакт — 3, компания — 4 (документация crm.item.*). */
const ENTITY_TYPE = { CO: 4, C: 3 } as const
/** Страница crm.item.list — 50: больше ID за раз не запрашиваем. */
export const CLIENT_NAMES_PAGE = 50

/** Разбор кода клиента; `null` — не код клиента. */
export function splitClient(code: string): { kind: 'CO' | 'C', id: number } | null {
  if (!isRateClient(code)) return null
  const [kind, id] = code.split('_') as ['CO' | 'C', string]
  return { kind, id: Number(id) }
}

/** Запросы названий: по одному на тип и страницу из 50 ID. */
export function clientNamesCalls(codes: string[]): RestCall[] {
  const ids: Record<'CO' | 'C', number[]> = { CO: [], C: [] }
  for (const code of new Set(codes)) {
    const c = splitClient(code)
    if (c) ids[c.kind].push(c.id)
  }
  const calls: RestCall[] = []
  for (const kind of ['CO', 'C'] as const) {
    for (let i = 0; i < ids[kind].length; i += CLIENT_NAMES_PAGE) {
      calls.push({
        method: 'crm.item.list',
        params: {
          entityTypeId: ENTITY_TYPE[kind],
          filter: { '@id': ids[kind].slice(i, i + CLIENT_NAMES_PAGE) },
          select: kind === 'CO' ? ['id', 'title'] : ['id', 'name', 'lastName']
        }
      })
    }
  }
  return calls
}

/** Названия из ответа crm.item.list (`{ items: [...] }`) запроса {@link clientNamesCalls}. */
export function parseClientNames(call: RestCall, result: unknown): Record<string, string> {
  const kind = call.params.entityTypeId === ENTITY_TYPE.CO ? 'CO' : 'C'
  const items = (result as { items?: unknown } | null)?.items
  const out: Record<string, string> = {}
  if (!Array.isArray(items)) return out
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = Number(o.id)
    if (!Number.isInteger(id) || id <= 0) continue
    const name = kind === 'CO'
      ? (typeof o.title === 'string' ? o.title : '')
      : [o.name, o.lastName].filter(v => typeof v === 'string' && v).join(' ')
    if (name) out[`${kind}_${id}`] = name
  }
  return out
}

/** Выбор в диалоге CRM → код клиента и название; ничего не выбрано — `null`. */
export function pickedClient(picked: SelectedCRM): { code: string, title: string } | null {
  const item = picked.company?.[0] ?? picked.contact?.[0]
  if (!item || !isRateClient(item.id)) return null
  return { code: item.id, title: item.title || item.id }
}

/** Подпись клиента: название или код, если название не прочиталось (нет доступа к CRM). */
export function clientLabel(code: string, names: Record<string, string>): string {
  const c = splitClient(code)
  const fallback = c ? `${c.kind === 'CO' ? 'Компания' : 'Контакт'} #${c.id}` : code
  return names[code] ?? fallback
}
