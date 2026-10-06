import { describe, expect, it } from 'vitest'
import { APP_FIELDS, camelFieldKey, fieldNames, clientTaskIdOf, isFieldName, missingAppFields, normalizeFieldName, parseUserFields } from '#shared/domain/userFields'
import { parseTask, tasksBoundTo } from '#shared/domain/tasks'
import { defaultSettings, parseSettings, serializeSettings } from '#shared/domain/settings'
import { taskListCall, TASK_SELECT } from '~/utils/invoiceRequests'
import { userFieldAddCall, userFieldListCall } from '~/utils/userFieldRequests'
import { fieldItems, withAppFields } from '~/utils/clientFieldSettings'

describe('коды UF', () => {
  it('принимает только UF_ латиницей до 50 символов, приводит к верхнему регистру', () => {
    expect(isFieldName('UF_SH_IFT_CLIENT_TASK')).toBe(true)
    expect(isFieldName('UF_')).toBe(false)
    expect(isFieldName(`UF_${'A'.repeat(48)}`)).toBe(false)
    expect(normalizeFieldName(' uf_crm_domain ')).toBe('UF_CRM_DOMAIN')
    expect(normalizeFieldName('TITLE')).toBe('')
    expect(normalizeFieldName('UF_X; DROP')).toBe('')
    expect(normalizeFieldName(5)).toBe('')
  })

  it('ключ в ответе tasks.task.list — camelCase', () => {
    expect(camelFieldKey('UF_CRM_TASK')).toBe('ufCrmTask')
    expect(camelFieldKey('UF_SH_IFT_CLIENT_TASK')).toBe('ufShIftClientTask')
    expect(camelFieldKey('UF_X_2')).toBe('ufX2')
  })
})

describe('ID задачи клиента', () => {
  it('строка или число; мусор и пусто — null', () => {
    expect(clientTaskIdOf(' 456 ')).toBe('456')
    expect(clientTaskIdOf(456)).toBe('456')
    expect(clientTaskIdOf('CL_12')).toBe('CL_12')
    // `-` — разделитель в «[102-456]»: с ним приставку не разобрать.
    expect(clientTaskIdOf('CL-12')).toBeNull()
    expect(clientTaskIdOf('456.0000')).toBeNull()
    expect(clientTaskIdOf('')).toBeNull()
    expect(clientTaskIdOf('4 5')).toBeNull()
    expect(clientTaskIdOf('<b>1</b>')).toBeNull()
    expect(clientTaskIdOf('1'.repeat(31))).toBeNull()
    expect(clientTaskIdOf(null)).toBeNull()
  })

  it('parseTask читает поле из настроек в camelCase и как есть; без поля — null', () => {
    expect(parseTask({ id: 1, ufShIftClientTask: '456' }, 'UF_SH_IFT_CLIENT_TASK')?.clientTaskId).toBe('456')
    expect(parseTask({ ID: 1, UF_SH_IFT_CLIENT_TASK: 789 }, 'UF_SH_IFT_CLIENT_TASK')?.clientTaskId).toBe('789')
    expect(parseTask({ id: 1, ufShIftClientTask: '456' })?.clientTaskId).toBeNull()
    // Боевой путь страницы — через tasksBoundTo: поле из настроек должно дойти до разбора.
    const rows = [{ id: 1, ufCrmTask: ['D_5'], ufShIftClientTask: '456' }]
    expect(tasksBoundTo(rows, ['D_5'], 'UF_SH_IFT_CLIENT_TASK')[0]?.clientTaskId).toBe('456')
    expect(tasksBoundTo(rows, ['D_5'])[0]?.clientTaskId).toBeNull()
  })

  it('поле добавляется в select списка задач, только если выбрано', () => {
    expect(taskListCall('D_5').params.select).toEqual(TASK_SELECT)
    expect(taskListCall('D_5', 'UF_SH_IFT_CLIENT_TASK').params.select).toEqual([...TASK_SELECT, 'UF_SH_IFT_CLIENT_TASK'])
  })
})

describe('настройки clientFields', () => {
  it('по умолчанию пусто, мусор — пусто, круг сериализации сохраняет', () => {
    expect(defaultSettings().clientFields).toEqual({ task: '', companyDomain: '', contactDomain: '' })
    expect(parseSettings({ clientFields: { task: 'TITLE', companyDomain: 5 } }).clientFields).toEqual({ task: '', companyDomain: '', contactDomain: '' })
    const s = { ...defaultSettings(), clientFields: { task: 'UF_A', companyDomain: 'UF_CRM_B', contactDomain: 'UF_CRM_C' } }
    expect(parseSettings(serializeSettings(s)).clientFields).toEqual(s.clientFields)
  })
})

describe('списки UF', () => {
  it('одиночные текстовые и числовые поля, подпись по-русски, без дублей, по алфавиту', () => {
    const list = parseUserFields([
      { FIELD_NAME: 'UF_B', USER_TYPE_ID: 'string', MULTIPLE: 'N', EDIT_FORM_LABEL: { en: 'B', ru: 'Бэ' } },
      { FIELD_NAME: 'UF_A', USER_TYPE_ID: 'integer', MULTIPLE: 'N', LIST_COLUMN_LABEL: 'Аа' },
      { FIELD_NAME: 'UF_A', USER_TYPE_ID: 'integer', MULTIPLE: 'N' },
      { FIELD_NAME: 'UF_M', USER_TYPE_ID: 'string', MULTIPLE: 'Y' },
      { FIELD_NAME: 'UF_CRM_TASK', USER_TYPE_ID: 'crm', MULTIPLE: 'Y' },
      { FIELD_NAME: 'UF_E', USER_TYPE_ID: 'enumeration', MULTIPLE: 'N' },
      { FIELD_NAME: 'UF_D', USER_TYPE_ID: 'double', MULTIPLE: 'N' },
      { FIELD_NAME: 'bad', USER_TYPE_ID: 'string' },
      null
    ])
    expect(list).toEqual([
      { name: 'UF_A', label: 'Аа', type: 'integer' },
      { name: 'UF_B', label: 'Бэ', type: 'string' }
    ])
    expect(parseUserFields({})).toEqual([])
  })

  it('запросы: задача — ORDER/FILTER, CRM — order/filter, листание start', () => {
    expect(userFieldListCall('task', 50)).toEqual({ method: 'task.item.userfield.getlist', params: { ORDER: { SORT: 'ASC' }, FILTER: {}, start: 50 } })
    expect(userFieldListCall('contact', 0)).toEqual({ method: 'crm.contact.userfield.list', params: { order: { SORT: 'ASC' }, filter: { LANG: 'ru' }, start: 0 } })
  })
})

describe('поля приложения', () => {
  it('«поле уже есть» — по всем кодам, любого типа', () => {
    const raw = [{ FIELD_NAME: 'UF_SH_IFT_CLIENT_TASK', USER_TYPE_ID: 'integer', MULTIPLE: 'Y' }, { FIELD_NAME: 'x' }, null]
    expect(fieldNames(raw)).toEqual(['UF_SH_IFT_CLIENT_TASK'])
    expect(missingAppFields({ task: fieldNames(raw), company: [], contact: [] }).every(f => f.entity !== 'task')).toBe(true)
  })

  it('создаём только отсутствующие', () => {
    expect(missingAppFields({ task: [], company: [], contact: [] })).toEqual(APP_FIELDS)
    const all = ['UF_CRM_SH_IFT_CLIENT_DOMAIN', 'UF_CRM_SH_IFT_ACCESS_CODE', 'UF_CRM_SH_IFT_CLIENT_HOOK']
    expect(missingAppFields({ task: ['UF_SH_IFT_CLIENT_TASK'], company: all, contact: all.slice(1) }))
      .toEqual([{ entity: 'contact', name: 'UF_CRM_SH_IFT_CLIENT_DOMAIN', label: '[sh::invoice-from-task] Домен Битрикс24 клиента', type: 'string' }])
  })

  it('подписи с приставкой приложения; CRM — без UF_CRM_ в коде', () => {
    for (const f of APP_FIELDS) expect(f.label.startsWith('[sh::invoice-from-task] ')).toBe(true)
    const task = userFieldAddCall(APP_FIELDS[0]!)
    expect(task.method).toBe('task.item.userfield.add')
    expect((task.params.PARAMS as Record<string, unknown>).FIELD_NAME).toBe('UF_SH_IFT_CLIENT_TASK')
    const company = userFieldAddCall(APP_FIELDS[1]!)
    expect(company.method).toBe('crm.company.userfield.add')
    expect((company.params.fields as Record<string, unknown>).FIELD_NAME).toBe('SH_IFT_CLIENT_DOMAIN')
    expect((company.params.fields as Record<string, unknown>).USER_TYPE_ID).toBe('string')
  })

  it('после создания невыбранные настройки получают поля приложения, выбранные не трогаем', () => {
    expect(withAppFields({ task: '', companyDomain: 'UF_CRM_MINE', contactDomain: '' }))
      .toEqual({ task: 'UF_SH_IFT_CLIENT_TASK', companyDomain: 'UF_CRM_MINE', contactDomain: 'UF_CRM_SH_IFT_CLIENT_DOMAIN' })
    expect(withAppFields({ task: 'UF_T', companyDomain: '', contactDomain: 'UF_CRM_C' }))
      .toEqual({ task: 'UF_T', companyDomain: 'UF_CRM_SH_IFT_CLIENT_DOMAIN', contactDomain: 'UF_CRM_C' })
  })
})

describe('пункты выпадающего списка', () => {
  const fields = [{ name: 'UF_A', label: 'Поле А', type: 'string' }, { name: 'UF_B', label: 'UF_B', type: 'string' }]

  it('«Не выбрано» первым, подпись с кодом', () => {
    expect(fieldItems(fields, '')).toEqual([
      { label: 'Не выбрано', value: '' },
      { label: 'Поле А (UF_A)', value: 'UF_A' },
      { label: 'UF_B', value: 'UF_B' }
    ])
  })

  it('сохранённое, которого нет в портале, — с пометкой; список не прочитан — без пометки', () => {
    expect(fieldItems(fields, 'UF_GONE').at(-1)).toEqual({ label: 'UF_GONE — нет в портале', value: 'UF_GONE' })
    expect(fieldItems(null, 'UF_GONE')).toEqual([{ label: 'Не выбрано', value: '' }, { label: 'UF_GONE', value: 'UF_GONE' }])
  })
})
