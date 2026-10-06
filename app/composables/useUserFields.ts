// Пользовательские поля для вкладки «Поля клиента»: списки UF задач, компаний и контактов и
// создание полей приложения кнопкой (#34). Параметры — app/utils/userFieldRequests.ts, разбор —
// shared/domain/userFields.ts. Создавать UF может только администратор — вкладка только для него.

import { fieldNames, missingAppFields, parseUserFields, type AppFieldSpec, type UserFieldOption } from '#shared/domain/userFields'
import { collectOffsetPages } from '~/utils/paging'
import { MAX_USER_FIELDS, needsAppId, USER_FIELDS_PAGE, userFieldAddCall, userFieldListCall, type FieldEntity } from '~/utils/userFieldRequests'

/** Поля для выбора и коды ВСЕХ UF сущности (для «поле уже есть», missingAppFields). */
export interface FieldList {
  options: UserFieldOption[]
  names: string[]
}
export type FieldLists = Record<FieldEntity, FieldList>

export function useUserFields() {
  const b24 = useB24()

  /** UF одной сущности, постранично. */
  async function list(entity: FieldEntity): Promise<FieldList> {
    let firstOfPrev = ''
    const raw = await collectOffsetPages(
      async (start) => {
        const { method, params } = userFieldListCall(entity, start)
        const res = await b24.call<unknown>(method, params)
        const page = Array.isArray(res) ? res : []
        // Старый метод мог бы не понять `start` и отдавать ту же страницу — тогда конец списка
        // (`total` у task.item.userfield.getlist всегда 0, документация), а не круг до потолка.
        const first = String((page[0] as Record<string, unknown> | undefined)?.FIELD_NAME ?? '')
        if (start > 0 && first && first === firstOfPrev) return []
        firstOfPrev = first
        return page
      },
      USER_FIELDS_PAGE,
      MAX_USER_FIELDS,
      `пользовательских полей больше ${MAX_USER_FIELDS} — список не показываем`
    )
    return { options: parseUserFields(raw), names: fieldNames(raw) }
  }

  /** Все три списка; сбой одного не прячет другие — его ошибка в `errors`. */
  async function listAll(): Promise<{ lists: FieldLists, errors: string[] }> {
    const entities: FieldEntity[] = ['task', 'company', 'contact']
    const results = await Promise.allSettled(entities.map(list))
    const lists: FieldLists = { task: { options: [], names: [] }, company: { options: [], names: [] }, contact: { options: [], names: [] } }
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
      task: lists.task.names,
      company: lists.company.names,
      contact: lists.contact.names
    })
    // Поля своих типов — с полным кодом `rest_<ID приложения>_<код>`: ID — из app.info, и проверяем
    // его ДО первой записи. Строковые поля — первыми: незарегистрированный тип (портал, где
    // установку не открывали после обновления) не должен оставить их несозданными (находка /code-review).
    let appId: number | undefined
    if (missing.some(needsAppId)) {
      appId = Number((await b24.call<{ ID?: unknown }>('app.info'))?.ID)
      if (!Number.isInteger(appId) || appId <= 0) throw new Error('портал не вернул ID приложения (app.info) — поля не созданы')
    }
    missing.sort((a, b) => Number(needsAppId(a)) - Number(needsAppId(b)))
    for (const spec of missing) {
      const { method, params } = userFieldAddCall(spec, appId)
      await b24.call(method, params)
    }
    return missing
  }

  return { listAll, createMissing }
}
