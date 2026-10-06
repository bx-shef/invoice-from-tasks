// Контекст поля своего типа (встройка USERFIELD_TYPE, #34): что за поле, чьё и в каком режиме.
// PLACEMENT_OPTIONS — документация «Как встроить виджет в лид в виде пользовательского поля»:
// MODE (edit/view), ENTITY_ID (CRM_COMPANY…), FIELD_NAME, ENTITY_VALUE_ID (ID элемента), VALUE.
// Регистр ключей — выбор портала, читаем без учёта регистра (как placement.ts).

import { crmEntityTypeOf } from '#shared/domain/appFieldTypes'
import { camelFieldKey, normalizeFieldName } from '#shared/domain/userFields'
import type { RestCall } from './invoiceRequests'

export interface FieldContext {
  mode: 'edit' | 'view'
  /** Компания — 4, контакт — 3; другое — поле открыто не там, где мы его поддерживаем. */
  entityTypeId: 3 | 4 | null
  /** ID элемента; 0 — элемент ещё не создан (форма создания). */
  itemId: number
  fieldName: string
  value: string
}

function pick(options: Readonly<Record<string, unknown>>, key: string): unknown {
  for (const [k, v] of Object.entries(options)) if (k.toUpperCase() === key) return v
  return undefined
}

/** Значение поля: строка; массив (множественное поле) — первое значение. */
function valueOf(raw: unknown): string {
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

export function fieldContext(options: Readonly<Record<string, unknown>> | null | undefined): FieldContext {
  const o = options ?? {}
  const id = Number(pick(o, 'ENTITY_VALUE_ID'))
  return {
    mode: String(pick(o, 'MODE') ?? '').toLowerCase() === 'edit' ? 'edit' : 'view',
    entityTypeId: crmEntityTypeOf(pick(o, 'ENTITY_ID')),
    itemId: Number.isInteger(id) && id > 0 ? id : 0,
    fieldName: normalizeFieldName(pick(o, 'FIELD_NAME')),
    value: valueOf(pick(o, 'VALUE'))
  }
}

/** Как записать значение: в режиме редактирования — в форму карточки (`setValue`, сохранит карточка),
 * в режиме просмотра — сразу в элемент (`crm.item.update` правами сотрудника). */
export type WritePlan = { kind: 'form' } | { kind: 'item', call: RestCall } | { kind: 'none', reason: string }

export function writePlan(ctx: FieldContext, value: string): WritePlan {
  if (ctx.mode === 'edit') return { kind: 'form' }
  if (!ctx.entityTypeId || !ctx.itemId || !ctx.fieldName) {
    return { kind: 'none', reason: 'Поле открыто вне карточки компании или контакта — изменить его здесь нельзя' }
  }
  return {
    kind: 'item',
    // Пользовательские поля в crm.item.* — в camelCase (`ufCrm…`), как и в ответах (документация crm.item.update).
    call: { method: 'crm.item.update', params: { entityTypeId: ctx.entityTypeId, id: ctx.itemId, fields: { [camelFieldKey(ctx.fieldName)]: value } } }
  }
}
