// Пользовательские поля для вкладки «Поля клиента»: списки UF задач, компаний и контактов и
// создание полей приложения кнопкой (#34). Параметры — app/utils/userFieldRequests.ts, разбор —
// shared/domain/userFields.ts. Создавать UF может только администратор — вкладка только для него.

import { missingAppFields, parseUserFields, type AppFieldSpec, type UserFieldOption } from '#shared/domain/userFields'
import { collectOffsetPages } from '~/utils/paging'
import { MAX_USER_FIELDS, USER_FIELDS_PAGE, userFieldAddCall, userFieldListCall, type FieldEntity } from '~/utils/userFieldRequests'

export type FieldLists = Record<FieldEntity, UserFieldOption[]>

export function useUserFields() {
  const b24 = useB24()

  /** Строковые и числовые UF одной сущности, постранично. */
  async function list(entity: FieldEntity): Promise<UserFieldOption[]> {
    const raw = await collectOffsetPages(
      async (start) => {
        const { method, params } = userFieldListCall(entity, start)
        const res = await b24.call<unknown>(method, params)
        return Array.isArray(res) ? res : []
      },
      USER_FIELDS_PAGE,
      MAX_USER_FIELDS,
      `пользовательских полей больше ${MAX_USER_FIELDS} — список не показываем`
    )
    return parseUserFields(raw)
  }

  /** Все три списка; сбой одного не прячет другие — его ошибка в `errors`. */
  async function listAll(): Promise<{ lists: FieldLists, errors: string[] }> {
    const entities: FieldEntity[] = ['task', 'company', 'contact']
    const results = await Promise.allSettled(entities.map(list))
    const lists: FieldLists = { task: [], company: [], contact: [] }
    const errors: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') lists[entities[i]!] = r.value
      else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
    })
    return { lists, errors }
  }

  /**
   * Создаёт поля приложения, которых нет. По одному и последовательно: создание поля не
   * повторяем (SDK без автоповторов записи, app/config/b24.ts) и останавливаемся на первой ошибке.
   */
  async function createMissing(lists: FieldLists): Promise<AppFieldSpec[]> {
    const missing = missingAppFields({
      task: lists.task.map(f => f.name),
      company: lists.company.map(f => f.name),
      contact: lists.contact.map(f => f.name)
    })
    for (const spec of missing) {
      const { method, params } = userFieldAddCall(spec)
      await b24.call(method, params)
    }
    return missing
  }

  return { listAll, createMissing }
}
