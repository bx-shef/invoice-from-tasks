// Пользовательские поля для вкладки «Поля клиента»: списки UF задач, компаний, контактов и счёта и
// создание полей приложения кнопкой (#34). Параметры — app/utils/userFieldRequests.ts, разбор —
// shared/domain/userFields.ts. Создавать UF может только администратор — вкладка только для него.

import { fieldNames, missingAppFields, parseUserFields, unlabeledFieldIds, withFieldLabels, type AppFieldSpec, type UserFieldOption } from '#shared/domain/userFields'
import { fieldTypeCalls, registeredTypeIds } from '#shared/domain/appFieldTypes'
import { absoluteHandler } from '~/utils/install'
import { collectOffsetPages } from '~/utils/paging'
import { MAX_USER_FIELDS, needsAppId, portalErrorText, USER_FIELDS_PAGE, userFieldAddCall, userFieldListCall, type FieldEntity } from '~/utils/userFieldRequests'

/** Поля для выбора и коды ВСЕХ UF сущности (для «поле уже есть», missingAppFields). */
export interface FieldList {
  options: UserFieldOption[]
  names: string[]
}
export type FieldLists = Record<FieldEntity, FieldList>

export function useUserFields() {
  const b24 = useB24()
  const config = useRuntimeConfig()

  /**
   * Полные коды своих типов полей. Незарегистрированные регистрирует здесь же (как установка,
   * fieldTypeCalls): портал, где после обновления приложения установку не открывали, иначе отвечал
   * «Указан неверный пользовательский тип» (отчёт владельца 2026-10-06).
   */
  async function ensureTypes(): Promise<Map<string, string>> {
    const siteUrl = config.public.siteUrl || window.location.origin
    if (!absoluteHandler(siteUrl, '/')) throw new Error('у приложения нет https-адреса (NUXT_PUBLIC_SITE_URL) — типы полей не зарегистрировать')
    const before = await b24.call<unknown>('userfieldtype.list')
    for (const call of fieldTypeCalls(before, path => absoluteHandler(siteUrl, path))) await b24.call(call.method, call.params)
    const appId = Number((await b24.call<{ ID?: unknown }>('app.info'))?.ID)
    return registeredTypeIds(await b24.call<unknown>('userfieldtype.list'), Number.isInteger(appId) && appId > 0 ? appId : null)
  }

  /** UF одной сущности, постранично; у счёта — из crm.item.fields (userfieldconfig.list просит своё право). */
  async function list(entity: FieldEntity): Promise<FieldList> {
    if (entity === 'invoice') {
      const fields = (await b24.call<{ fields?: Record<string, { upperName?: unknown }> }>('crm.item.fields', { entityTypeId: 31 }))?.fields ?? {}
      return { options: [], names: Object.values(fields).map(f => String(f?.upperName ?? '')).filter(n => n.startsWith('UF_')) }
    }
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
    const options = parseUserFields(raw)
    // У задач список приходит без подписей — дочитываем их пакетом; сбой — остаются коды.
    if (entity === 'task') {
      const ids = unlabeledFieldIds(raw, options)
      if (ids.length) {
        const details = await b24.batch<unknown>(ids.map(ID => ['task.item.userfield.get', { ID }])).catch(() => [])
        return { options: withFieldLabels(options, details), names: fieldNames(raw) }
      }
    }
    return { options, names: fieldNames(raw) }
  }

  /** Все три списка; сбой одного не прячет другие — его ошибка в `errors`. */
  async function listAll(): Promise<{ lists: FieldLists, errors: string[] }> {
    const entities: FieldEntity[] = ['task', 'company', 'contact', 'invoice']
    const results = await Promise.allSettled(entities.map(list))
    const lists: FieldLists = { task: { options: [], names: [] }, company: { options: [], names: [] }, contact: { options: [], names: [] }, invoice: { options: [], names: [] } }
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
      contact: lists.contact.names,
      invoice: lists.invoice.names
    })
    // Строковые поля — первыми: сбой своих типов не должен оставить их несозданными. Типы — до
    // первого поля своего типа: зарегистрировать, если их нет, и взять полные коды из ответа портала.
    missing.sort((a, b) => Number(needsAppId(a)) - Number(needsAppId(b)))
    let types: Map<string, string> | null = null
    for (const spec of missing) {
      try {
        if (needsAppId(spec)) types ??= await ensureTypes()
        const { method, params } = userFieldAddCall(spec, types?.get(spec.type))
        await b24.call(method, params)
      } catch (e) {
        // Какое поле — в сообщении: иначе «неверный пользовательский тип» не к чему приложить.
        throw new Error(`${spec.label} (${spec.name}): ${portalErrorText(e)}`, { cause: e })
      }
    }
    return missing
  }

  return { listAll, createMissing }
}
