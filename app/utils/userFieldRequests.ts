// Параметры REST-запросов пользовательских полей (#34): список UF задач, компаний и контактов
// для выбора в настройках и создание полей приложения кнопкой. Методы — docs/REST_METHODS.md.

import { fullTypeId } from '#shared/domain/appFieldTypes'
import type { AppFieldSpec } from '#shared/domain/userFields'
import type { RestCall } from './invoiceRequests'

export type FieldEntity = AppFieldSpec['entity']

/** Страница списков UF — 50 (документация task.item.userfield.getlist; у CRM — так же). */
export const USER_FIELDS_PAGE = 50
/** Потолок полей одной сущности, которые читаем. */
export const MAX_USER_FIELDS = 1000

/** Страница списка UF сущности: листание `start`. */
export function userFieldListCall(entity: FieldEntity, start: number): RestCall {
  if (entity === 'task') {
    // ORDER и FILTER обязательны (документация метода); пустой фильтр — все поля.
    return { method: 'task.item.userfield.getlist', params: { ORDER: { SORT: 'ASC' }, FILTER: {}, start } }
  }
  // LANG — иначе портал не отдаёт подписи полей, и в списке были бы голые коды (документация
  // crm.*.userfield.list: подписи — по языку из фильтра).
  return { method: `crm.${entity}.userfield.list`, params: { order: { SORT: 'ASC' }, filter: { LANG: 'ru' }, start } }
}

/** Нужен ли ID приложения (app.info) для создания поля: да — у полей своих типов. */
export function needsAppId(spec: AppFieldSpec): boolean {
  return spec.type !== 'string'
}

/**
 * Создание поля приложения. `appId` — ID приложения (app.info → ID) для полей своих типов.
 *
 * У задач код передаётся целиком (`UF_` портал добавит сам, если его
 * нет); у CRM — без приставки `UF_CRM_`: её добавляет портал (документация crm.*.userfield.add).
 */
export function userFieldAddCall(spec: AppFieldSpec, appId?: number): RestCall {
  if (needsAppId(spec) && !(appId && appId > 0)) throw new Error(`для поля ${spec.name} нужен ID приложения`)
  const type = spec.type === 'string' ? 'string' : fullTypeId(appId!, spec.type)
  if (spec.entity === 'task') {
    return {
      method: 'task.item.userfield.add',
      params: { PARAMS: { USER_TYPE_ID: type, FIELD_NAME: spec.name, XML_ID: spec.name, LABEL: spec.label, EDIT_FORM_LABEL: { ru: spec.label, en: spec.label }, MULTIPLE: 'N', MANDATORY: 'N' } }
    }
  }
  return {
    method: `crm.${spec.entity}.userfield.add`,
    params: {
      fields: {
        USER_TYPE_ID: type,
        FIELD_NAME: spec.name.replace(/^UF_CRM_/, ''),
        XML_ID: spec.name,
        LABEL: spec.label,
        EDIT_FORM_LABEL: spec.label,
        LIST_COLUMN_LABEL: spec.label,
        LIST_FILTER_LABEL: spec.label,
        MULTIPLE: 'N',
        MANDATORY: 'N'
      }
    }
  }
}
