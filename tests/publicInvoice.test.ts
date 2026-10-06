import { describe, expect, it } from 'vitest'
import { clientDomainOf, clientTaskIdFor, invoiceBindingCodes, taskBoundTo, parsePublicClient, parsePublicInvoice, parsePublicTask, plainText, publicRows, rowTaskIds, rowTaskRef, stageName } from '#shared/domain/publicInvoice'
import { DEFAULT_CLOSED_TEXT, defaultSettings, parseSettings, serializeSettings } from '#shared/domain/settings'
import { invoiceStageEntities, publicInvoiceUrl, stageItems, stageOptions } from '~/utils/invoiceStages'

describe('приставка строки', () => {
  it('«[123-456]» и «[123]»; иначе null', () => {
    expect(rowTaskRef('[123-456] Задача')).toEqual({ taskId: 123, clientTaskId: '456' })
    expect(rowTaskRef('[123] Задача')).toEqual({ taskId: 123, clientTaskId: null })
    expect(rowTaskRef('Задача [123]')).toBeNull()
    expect(rowTaskRef('[0] x')).toBeNull()
  })
})

describe('счёт и клиенты', () => {
  it('счёт: стадия, дата, клиент', () => {
    expect(parsePublicInvoice({ item: { id: 5, title: 'Счёт №5', stageId: 'DT31_1:N', begindate: '2026-10-01T03:00:00+03:00', currencyId: 'BYN', opportunity: '120.5', companyId: 3, contactIds: [7, 7, 0], mycompanyId: 1 } }))
      .toEqual({ id: 5, title: 'Счёт №5', stageId: 'DT31_1:N', date: '2026-10-01', currencyId: 'BYN', opportunity: 120.5, companyId: 3, contactIds: [7], myCompanyId: 1, dealId: null })
    expect(parsePublicInvoice({ item: {} })).toBeNull()
  })

  it('клиент: код только похожий на код; домен — хост без схемы', () => {
    const c = parsePublicClient('contact', { item: { id: 7, name: 'Иван', lastName: 'Петров', ufCrmShIftAccessCode: 'ABCDEFGHJK', ufCrmDomain: 'https://Client.bitrix24.ru/' } }, 'UF_CRM_SH_IFT_ACCESS_CODE', 'UF_CRM_DOMAIN')
    expect(c).toEqual({ kind: 'contact', id: 7, title: 'Иван Петров', accessCode: 'ABCDEFGHJK', domain: 'client.bitrix24.ru' })
    expect(parsePublicClient('company', { item: { id: 3, title: 'А', ufCrmShIftAccessCode: 'short' } }, 'UF_CRM_SH_IFT_ACCESS_CODE', '')?.accessCode).toBeNull()
    expect(clientDomainOf('not a domain')).toBeNull()
    expect(clientDomainOf('a.b/c?x')).toBe('a.b')
  })
})

describe('строки и задачи', () => {
  const rows = publicRows([
    { id: 2, productName: '[11-77] Вторая', price: 10, quantity: 3, sort: 20 },
    { id: 1, productName: '[10] Первая', price: 100.005, quantity: 1, sort: 10 },
    { id: 3, productName: 'Без задачи', price: 5, quantity: 1, sort: 30 },
    { id: 4, productName: '[10] Ещё по первой', price: 1, quantity: 1, sort: 40 }
  ])

  it('порядок, сумма с налогом как в портале, ссылка на задачу', () => {
    expect(rows.map(r => [r.name, r.sum, r.taskId, r.clientTaskId])).toEqual([
      ['[10] Первая', 100.01, 10, null],
      ['[11-77] Вторая', 30, 11, '77'],
      ['Без задачи', 5, null, null],
      ['[10] Ещё по первой', 1, 10, null]
    ])
    expect(rowTaskIds(rows, 10)).toEqual([10, 11])
    expect(rowTaskIds(rows, 1)).toEqual([10])
  })

  it('номер задачи клиента: из строки, иначе из UF задачи', () => {
    expect(clientTaskIdFor(rows, 11, {}, '')).toBe('77')
    expect(clientTaskIdFor(rows, 10, { task: { ufShIftClientTask: '55' } }, 'UF_SH_IFT_CLIENT_TASK')).toBe('55')
    expect(clientTaskIdFor(rows, 10, { task: {} }, '')).toBeNull()
  })

  it('задача: текст без BB-кода, ссылки на нашу и клиентскую задачу', () => {
    const t = parsePublicTask({ task: { id: '10', title: 'Лендинг', description: '[B]Сделать[/B] [URL=https://x]макет[/URL]' } }, 'https://my.bitrix24.by', '77', 'client.bitrix24.ru', [{ text: 'Готово' }, { text: '' }])
    expect(t).toEqual({
      id: 10,
      title: 'Лендинг',
      description: 'Сделать макет',
      results: ['Готово'],
      url: 'https://my.bitrix24.by/company/personal/user/0/tasks/task/view/10/',
      clientTaskId: '77',
      clientTaskUrl: 'https://client.bitrix24.ru/company/personal/user/0/tasks/task/view/77/'
    })
    expect(parsePublicTask({ task: { id: 10 } }, 'https://m', 'CL_1', 'c.ru', null)?.clientTaskUrl).toBeNull()
    expect(plainText('<script>x</script>')).toBe('<script>x</script>')
    // Имя тега целиком: «[important]» и «[list of changes]» — текст; таблицы — теги.
    expect(plainText('Сделано [important], см. [list of changes] [TABLE][TR][TD]x[/TD][/TR][/TABLE] [USER=1]Иван[/USER]')).toBe('Сделано [important], см. [list of changes] x Иван')
    expect(plainText('я'.repeat(5000))).toHaveLength(4000)
  })

  it('название стадии; нет — код', () => {
    expect(stageName([{ STATUS_ID: 'DT31_1:N', NAME: 'Новый' }], 'DT31_1:N')).toBe('Новый')
    expect(stageName([], 'DT31_1:P')).toBe('DT31_1:P')
  })
})

describe('привязка задачи к счёту', () => {
  it('счёт и его сделка; регистр кода не важен', () => {
    const codes = invoiceBindingCodes({ id: 5, dealId: 9 })
    expect(codes).toEqual(['SI_5', 'T1f_5', 'D_9'])
    expect(taskBoundTo({ task: { ufCrmTask: ['D_9'] } }, codes)).toBe(true)
    expect(taskBoundTo({ task: { UF_CRM_TASK: ['t1F_5'] } }, codes)).toBe(true)
    expect(taskBoundTo({ task: { ufCrmTask: ['D_10'] } }, codes)).toBe(false)
    expect(taskBoundTo({ task: {} }, codes)).toBe(false)
    expect(invoiceBindingCodes({ id: 5, dealId: null })).toEqual(['SI_5', 'T1f_5'])
  })
})

describe('настройки publicPage', () => {
  it('по умолчанию — ни одной стадии и фраза по умолчанию; мусор отбрасывается', () => {
    expect(defaultSettings().publicPage).toEqual({ stages: [], closedText: DEFAULT_CLOSED_TEXT })
    expect(parseSettings({ publicPage: { stages: ['DT31_1:N', 'DT31_1:N', 'bad stage', 5], closedText: '  ' } }).publicPage)
      .toEqual({ stages: ['DT31_1:N'], closedText: DEFAULT_CLOSED_TEXT })
    const s = { ...defaultSettings(), publicPage: { stages: ['DT31_1:P'], closedText: 'Звоните' } }
    expect(parseSettings(serializeSettings(s)).publicPage).toEqual(s.publicPage)
  })
})

describe('стадии в настройках', () => {
  it('справочники счёта, стадии по SORT, воронка в подписи при нескольких', () => {
    expect(invoiceStageEntities([{ ID: 'STATUS', ENTITY_TYPE_ID: 1 }, { ID: 'SMART_INVOICE_STAGE_1', ENTITY_TYPE_ID: 31, CATEGORY_NAME: 'Общая' }]))
      .toEqual([{ id: 'SMART_INVOICE_STAGE_1', category: 'Общая' }])
    const opts = stageOptions([{ STATUS_ID: 'B', NAME: 'Б', SORT: 20 }, { STATUS_ID: 'A', NAME: 'А', SORT: 10 }], 'Общая', true)
    expect(opts).toEqual([{ id: 'A', label: 'Общая: А' }, { id: 'B', label: 'Общая: Б' }])
    expect(stageItems(opts, ['A', 'GONE']).at(-1)).toEqual({ label: 'GONE — нет в портале', value: 'GONE' })
    expect(stageItems(null, ['GONE'])).toEqual([{ label: 'GONE', value: 'GONE' }])
  })

  it('адрес публичной страницы', () => {
    expect(publicInvoiceUrl('https://ift.bx-shef.by/', 'my.bitrix24.by', 123)).toBe('https://ift.bx-shef.by/p-my.bitrix24.by/i-123')
  })
})
