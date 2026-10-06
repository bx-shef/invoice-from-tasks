import { describe, expect, it } from 'vitest'
import { documentPdfCheck, documentPdfUrl, latestDocuments, pdfFileName, clientDomainOf, clientTaskIdFor, invoiceBindingCodes, taskBoundTo, parsePublicClient, parsePublicInvoice, parsePublicTask, plainText, publicRows, rowTaskIds, rowTaskRef, stageName } from '#shared/domain/publicInvoice'
import { DEFAULT_CLOSED_TEXT, defaultSettings, parseSettings, serializeSettings } from '#shared/domain/settings'
import { invoiceStageEntities, publicInvoiceUrl, stageItems, stageOptions, templateItems, templateOptions } from '~/utils/invoiceStages'

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
    const c = parsePublicClient('contact', { item: { id: 7, name: 'Иван', lastName: 'Петров', ufCrmShIftAccessCode: 'ABCDEFGHJK' } }, 'UF_CRM_SH_IFT_ACCESS_CODE')
    expect(c).toEqual({ kind: 'contact', id: 7, title: 'Иван Петров', accessCode: 'ABCDEFGHJK', hook: null })
    expect(parsePublicClient('company', { item: { id: 3, title: 'А', ufCrmShIftAccessCode: 'short' } }, 'UF_CRM_SH_IFT_ACCESS_CODE')?.accessCode).toBeNull()
    expect(clientDomainOf('https://Client.bitrix24.ru/')).toBe('client.bitrix24.ru')
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
    const t = parsePublicTask({ task: { id: '10', title: 'Лендинг', description: '[B]Сделать[/B] [URL=https://x]макет[/URL]', ufSourceDomain: 'client.bitrix24.ru' } }, 'https://my.bitrix24.by', '77', [{ text: 'Готово' }, { text: '' }], 'UF_SOURCE_DOMAIN')
    expect(t).toEqual({
      id: 10,
      title: 'Лендинг',
      description: 'Сделать макет',
      results: ['Готово'],
      url: 'https://my.bitrix24.by/company/personal/user/0/tasks/task/view/10/',
      clientTaskId: '77',
      clientTaskUrl: 'https://client.bitrix24.ru/company/personal/user/0/tasks/task/view/77/'
    })
    // Нечисловой номер или нет домена в задаче (пусто, поле не выбрано) — без ссылки, только номер.
    expect(parsePublicTask({ task: { id: 10, ufSourceDomain: 'c.ru' } }, 'https://m', 'CL_1', null, 'UF_SOURCE_DOMAIN')?.clientTaskUrl).toBeNull()
    expect(parsePublicTask({ task: { id: 10, ufSourceDomain: '' } }, 'https://m', '7', null, 'UF_SOURCE_DOMAIN')?.clientTaskUrl).toBeNull()
    expect(parsePublicTask({ task: { id: 10, ufSourceDomain: 'c.ru' } }, 'https://m', '7', null)?.clientTaskUrl).toBeNull()
    expect(parsePublicTask({ task: { id: 10, ufSourceDomain: 'portal.standartno.by' } }, 'https://m', '120536', null, 'UF_SOURCE_DOMAIN')?.clientTaskUrl)
      .toBe('https://portal.standartno.by/company/personal/user/0/tasks/task/view/120536/')
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
    expect(defaultSettings().publicPage).toEqual({ stages: [], closedText: DEFAULT_CLOSED_TEXT, templates: [] })
    expect(parseSettings({ publicPage: { stages: ['DT31_1:N', 'DT31_1:N', 'bad stage', 5], closedText: '  ', templates: [3, '4', 3, 0, 'x'] } }).publicPage)
      .toEqual({ stages: ['DT31_1:N'], closedText: DEFAULT_CLOSED_TEXT, templates: [3, 4] })
    const s = { ...defaultSettings(), publicPage: { stages: ['DT31_1:P'], closedText: 'Звоните', templates: [7] } }
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

describe('документы — разбор', () => {
  it('последний по шаблону, только с PDF и только этого счёта; порядок — как в настройках', () => {
    const raw = { documents: [
      { id: 1, title: 'А1', templateId: 3, pdfId: 1, entityTypeId: 31, entityId: 5 },
      { id: 2, title: 'А2', templateId: 3, pdfId: 1, entityTypeId: 31, entityId: 5 },
      { id: 3, title: 'Без PDF', templateId: 4, pdfId: null, entityTypeId: 31, entityId: 5 },
      { id: 4, title: 'Чужой', templateId: 4, pdfId: 1, entityTypeId: 31, entityId: 6 },
      { id: 5, title: 'Акт', templateId: 4, pdfId: 1, entityTypeId: 31, entityId: 5 },
      { id: 6, title: 'Не тот шаблон', templateId: 9, pdfId: 1, entityTypeId: 31, entityId: 5 }
    ] }
    expect(latestDocuments(raw, [4, 3], 5)).toEqual([{ id: 5, title: 'Акт', templateId: 4 }, { id: 2, title: 'А2', templateId: 3 }])
    expect(latestDocuments(null, [3], 5)).toEqual([])
  })

  it('ссылка на PDF: только https на сам портал, без порта и логина', () => {
    const base = { templateId: 3, pdfId: 1, entityTypeId: '31', entityId: '5', title: 'С' }
    expect(documentPdfUrl({ document: { ...base, pdfUrlMachine: 'https://my.by/rest/x.json?auth=1' } }, [3], 5, 'my.by')).toEqual({ url: 'https://my.by/rest/x.json?auth=1', title: 'С' })
    for (const url of ['http://my.by/x', 'https://my.by:8443/x', 'https://u:p@my.by/x', 'https://evil.my.by/x', 'нет']) {
      expect(documentPdfUrl({ document: { ...base, pdfUrlMachine: url } }, [3], 5, 'my.by'), url).toBeNull()
    }
    expect(documentPdfUrl({ document: { ...base, pdfId: 0, pdfUrlMachine: 'https://my.by/x' } }, [3], 5, 'my.by')).toBeNull()
  })

  it('причины отказа — для журнала', () => {
    const base = { templateId: 3, pdfId: 1, entityTypeId: 31, entityId: 5 }
    expect(documentPdfCheck(null, [3], 5, 'my.by')).toEqual({ ok: false, reason: 'no document' })
    expect(documentPdfCheck({ ...base, templateId: 4 }, [3], 5, 'my.by')).toEqual({ ok: false, reason: 'template 4 not allowed' })
    expect(documentPdfCheck({ ...base, pdfId: 0 }, [3], 5, 'my.by')).toEqual({ ok: false, reason: 'no pdfId' })
    expect(documentPdfCheck({ ...base, entityTypeId: 'SMART_INVOICE' }, [3], 5, 'my.by')).toEqual({ ok: false, reason: 'entity SMART_INVOICE/5' })
    expect(documentPdfCheck(base, [3], 5, 'my.by')).toEqual({ ok: false, reason: 'no pdfUrlMachine' })
    expect(documentPdfCheck({ ...base, pdfUrlMachine: 'https://cdn.my.by:8443/x' }, [3], 5, 'my.by')).toEqual({ ok: false, reason: 'pdfUrlMachine host https://cdn.my.by:8443, portal my.by' })
  })

  it('имя файла — без опасных символов', () => {
    expect(pdfFileName('Счёт №5 / "акт"', 61)).toBe('Счёт 5 акт.pdf')
    // Слеши и кавычки вырезаются: имя не уводит из каталога загрузок и не ломает заголовок.
    expect(pdfFileName('../a"b', 61)).toBe('.. a b.pdf')
    expect(pdfFileName('', 61)).toBe('document-61.pdf')
  })

  it('шаблоны в настройках: активные по названию; сохранённый, которого нет, — с пометкой', () => {
    const opts = templateOptions({ templates: [{ id: '2', name: 'Счёт', active: 'Y' }, { id: 3, name: 'Акт' }, { id: 4, name: 'Старый', active: 'N' }, { id: 0 }] })
    expect(opts).toEqual([{ id: 3, label: 'Акт' }, { id: 2, label: 'Счёт' }])
    // Документация: templates — объект по ID, не массив.
    expect(templateOptions({ templates: { 39: { id: '39', name: 'Счёт' }, 37: { id: '37', name: 'Акт' } } })).toEqual([{ id: 37, label: 'Акт' }, { id: 39, label: 'Счёт' }])
    expect(templateItems(opts, [9]).at(-1)).toEqual({ label: 'Шаблон #9 — нет в портале', value: 9 })
    expect(templateItems(null, [9])).toEqual([{ label: 'Шаблон #9', value: 9 }])
  })
})
