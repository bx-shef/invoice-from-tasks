import { describe, expect, it } from 'vitest'
import { APP_FIELDS, camelFieldKey, fieldNames, clientTaskIdOf, isFieldName, missingAppFields, normalizeFieldName, parseUserFields, unlabeledFieldIds, withFieldLabels } from '#shared/domain/userFields'
import { parseTask, tasksBoundTo } from '#shared/domain/tasks'
import { defaultSettings, parseSettings, serializeSettings } from '#shared/domain/settings'
import { taskListCall, TASK_SELECT } from '~/utils/invoiceRequests'
import { needsAppId, userFieldAddCall, userFieldListCall } from '~/utils/userFieldRequests'
import { fieldItems, withAppEconomyFields, withAppFields, withAppInvoiceFields } from '~/utils/clientFieldSettings'

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
    // Числовое поле: целое с нулевой дробью — номер, дробное — нет.
    expect(clientTaskIdOf('456.0000')).toBe('456')
    expect(clientTaskIdOf(120536)).toBe('120536')
    expect(clientTaskIdOf('456.5')).toBeNull()
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
    expect(defaultSettings().clientFields).toEqual({ task: '', taskDomain: '' })
    // Старые поля домена компании и контакта (до 2026-10-06) отбрасываются разбором.
    expect(parseSettings({ clientFields: { task: 'TITLE', taskDomain: 5, companyDomain: 'UF_CRM_B' } }).clientFields).toEqual({ task: '', taskDomain: '' })
    const s = { ...defaultSettings(), clientFields: { task: 'UF_A', taskDomain: 'UF_SOURCE_DOMAIN' } }
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

describe('поля счёта приложения', () => {
  it('создаются userfieldconfig.add в CRM_SMART_INVOICE полным кодом, системным типом', () => {
    const ok = APP_FIELDS.find(f => f.name === 'UF_CRM_SMART_INVOICE_SH_IFT_OK')!
    expect(userFieldAddCall(ok)).toEqual({
      method: 'userfieldconfig.add',
      params: { moduleId: 'crm', field: { entityId: 'CRM_SMART_INVOICE', fieldName: 'UF_CRM_SMART_INVOICE_SH_IFT_OK', userTypeId: 'boolean', xmlId: 'UF_CRM_SMART_INVOICE_SH_IFT_OK', multiple: 'N', mandatory: 'N', editFormLabel: { ru: ok.label, en: ok.label } } }
    })
    // ссылка полем больше не создаётся (владелец 2026-10-09) — её показывает «Экономика счёта»; QR — для шаблона
    expect(APP_FIELDS.filter(f => f.entity === 'invoice').map(f => [f.type, needsAppId(f)])).toEqual([['url', false], ['boolean', false], ['datetime', false], ['string', false], ['ift_economics', true]])
    for (const f of APP_FIELDS.filter(f => f.entity === 'invoice')) expect(f.name.length).toBeLessThanOrEqual(50)
  })

  it('экономика: свои поля задачи и счёта подставляются, выбранное администратором не трогаем', () => {
    const d = defaultSettings()
    const next = withAppEconomyFields({ taskFields: { ...d.taskFields, workCost: 'UF_COST_OWN' }, economics: d.economics })
    expect(next.taskFields).toEqual({ workCost: 'UF_COST_OWN', diffPercent: 'UF_SH_IFT_DIFF_PCT', delta: 'UF_SH_IFT_DELTA' })
    expect(next.economics.invoiceField).toBe('UF_CRM_SMART_INVOICE_SH_IFT_ECON')
    expect(userFieldAddCall(APP_FIELDS.find(f => f.name === 'UF_SH_IFT_WORK_COST')!).params).toMatchObject({ PARAMS: { USER_TYPE_ID: 'double' } })
  })

  it('после создания — выбраны в настройках публичной страницы, если там пусто', () => {
    const page = withAppInvoiceFields({ ...defaultSettings().publicPage, qrField: 'UF_CRM_SMART_INVOICE_MY' })
    expect(page).toMatchObject({ linkField: '', qrField: 'UF_CRM_SMART_INVOICE_MY', approvedField: 'UF_CRM_SMART_INVOICE_SH_IFT_OK', approvedAtField: 'UF_CRM_SMART_INVOICE_SH_IFT_OK_AT' })
  })
})

describe('поля приложения', () => {
  it('«поле уже есть» — по всем кодам, любого типа', () => {
    const raw = [{ FIELD_NAME: 'UF_SH_IFT_CLIENT_TASK', USER_TYPE_ID: 'integer', MULTIPLE: 'Y' }, { FIELD_NAME: 'x' }, null]
    expect(fieldNames(raw)).toEqual(['UF_SH_IFT_CLIENT_TASK'])
    expect(missingAppFields({ task: fieldNames(raw), company: [], contact: [], invoice: [] }).map(f => f.name)).not.toContain('UF_SH_IFT_CLIENT_TASK')
  })

  it('создаём только отсутствующие', () => {
    expect(missingAppFields({ task: [], company: [], contact: [], invoice: [] })).toEqual(APP_FIELDS)
    const crm = ['UF_CRM_SH_IFT_ACCESS_CODE', 'UF_CRM_SH_IFT_CLIENT_HOOK']
    const invoice = APP_FIELDS.filter(f => f.entity === 'invoice').map(f => f.name)
    const economy = ['UF_SH_IFT_WORK_COST', 'UF_SH_IFT_DIFF_PCT', 'UF_SH_IFT_DELTA']
    expect(missingAppFields({ task: ['UF_SH_IFT_CLIENT_TASK', ...economy], company: crm, contact: crm, invoice }))
      .toEqual([{ entity: 'task', name: 'UF_SH_IFT_CLIENT_DOMAIN', label: '[sh::invoice-from-task] Домен Битрикс24 клиента', type: 'string' }])
  })

  it('подписи с приставкой приложения; CRM — без UF_CRM_ в коде', () => {
    for (const f of APP_FIELDS) expect(f.label.startsWith('[sh::invoice-from-task] ')).toBe(true)
    const task = userFieldAddCall(APP_FIELDS[0]!)
    expect(task.method).toBe('task.item.userfield.add')
    expect((task.params.PARAMS as Record<string, unknown>).FIELD_NAME).toBe('UF_SH_IFT_CLIENT_TASK')
    const company = userFieldAddCall(APP_FIELDS.find(f => f.entity === 'company')!, 'rest_12_ift_access_code')
    expect(company.method).toBe('crm.company.userfield.add')
    expect((company.params.fields as Record<string, unknown>).FIELD_NAME).toBe('SH_IFT_ACCESS_CODE')
    expect((company.params.fields as Record<string, unknown>).USER_TYPE_ID).toBe('rest_12_ift_access_code')
  })

  it('после создания невыбранные настройки получают поля приложения, выбранные не трогаем', () => {
    expect(withAppFields({ task: '', taskDomain: 'UF_SOURCE_DOMAIN' })).toEqual({ task: 'UF_SH_IFT_CLIENT_TASK', taskDomain: 'UF_SOURCE_DOMAIN' })
    expect(withAppFields({ task: 'UF_T', taskDomain: '' })).toEqual({ task: 'UF_T', taskDomain: 'UF_SH_IFT_CLIENT_DOMAIN' })
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

describe('подписи полей задачи', () => {
  it('без подписи в списке — ID на дочитку; подпись из task.item.userfield.get, по-русски', () => {
    const raw = [
      { ID: '11', FIELD_NAME: 'UF_AUTO_477375119602', USER_TYPE_ID: 'string' },
      { ID: '12', FIELD_NAME: 'UF_SOURCE_DOMAIN', USER_TYPE_ID: 'string', EDIT_FORM_LABEL: { ru: 'Домен клиента' } }
    ]
    const options = parseUserFields(raw)
    expect(unlabeledFieldIds(raw, options)).toEqual([11])
    const named = withFieldLabels(options, [{ FIELD_NAME: 'UF_AUTO_477375119602', EDIT_FORM_LABEL: { en: 'Client task', ru: 'ID задачи клиента' } }])
    expect(named.map(o => o.label)).toEqual(['Домен клиента', 'ID задачи клиента'])
    expect(withFieldLabels(options, [null, {}])).toHaveLength(2)
  })
})
