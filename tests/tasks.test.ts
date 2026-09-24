import { describe, expect, it } from 'vitest'
import { crmBindingCodes, listRows, parseTask, parseTimeEntry, tasksBoundTo } from '#shared/domain/tasks'
import { parseInvoice, invoiceProblems } from '#shared/domain/invoice'
import { defaultSettings } from '#shared/domain/settings'

describe('разбор задач', () => {
  it('читает camelCase-ответ tasks.task.list, где числа пришли строками', () => {
    const t = parseTask({ id: '15', title: ' Задача ', responsibleId: '7', ufCrmTask: ['D_5', 'C_2'], timeSpentInLogs: '3600' })
    expect(t).toEqual({ id: 15, title: 'Задача', description: '', responsibleId: 7, crmBindings: ['D_5', 'C_2'], timeSpentInLogs: 3600 })
  })

  it('понимает и UPPER_CASE-ключи', () => {
    expect(parseTask({ ID: '3', TITLE: 'X', RESPONSIBLE_ID: '1', UF_CRM_TASK: 'D_1' })?.crmBindings).toEqual(['D_1'])
  })

  it('берёт строки из обёртки { tasks: [...] }', () => {
    expect(listRows({ tasks: [{ id: 1 }] }, 'tasks')).toHaveLength(1)
    expect(listRows(null, 'tasks')).toEqual([])
  })
})

describe('перепроверка привязки к CRM', () => {
  it('отбрасывает задачи, которые фильтр портала пропустил', () => {
    // Непонятый фильтр портал игнорирует и отдаёт всё — это и ловим.
    const rows = [
      { id: '1', ufCrmTask: ['D_5'] },
      { id: '2', ufCrmTask: ['D_6'] },
      { id: '3', ufCrmTask: [] },
      { id: '1', ufCrmTask: ['D_5'] }
    ]
    expect(tasksBoundTo(rows, crmBindingCodes(2, 5)).map(t => t.id)).toEqual([1])
  })

  it('для счёта ищет оба возможных кода, без учёта регистра', () => {
    expect(crmBindingCodes(31, 8)).toEqual(['SI_8', 'T1f_8'])
    expect(tasksBoundTo([{ id: '4', ufCrmTask: ['T1F_8'] }], crmBindingCodes(31, 8)).map(t => t.id)).toEqual([4])
  })
})

describe('разбор записей времени', () => {
  it('берёт дату начала работы, а не дату внесения записи', () => {
    const e = parseTimeEntry({ ID: '101', TASK_ID: '10', USER_ID: '7', SECONDS: '5100', COMMENT_TEXT: ' Вёрстка ', CREATED_DATE: '2026-06-05T10:00:00+03:00', DATE_START: '2026-06-01T09:00:00+03:00' })
    expect(e).toEqual({ id: 101, taskId: 10, userId: 7, seconds: 5100, comment: 'Вёрстка', date: '2026-06-01' })
  })

  it('без даты начала — дата внесения', () => {
    expect(parseTimeEntry({ ID: '1', TASK_ID: '2', SECONDS: '60', CREATED_DATE: '2026-06-05T10:00:00+03:00' })?.date).toBe('2026-06-05')
  })

  it('запись без id или задачи отбрасывается', () => {
    expect(parseTimeEntry({ SECONDS: '60' })).toBeNull()
  })
})

describe('счёт', () => {
  it('читает crm.item.get и связь со сделкой', () => {
    const inv = parseInvoice({ item: { id: 8, title: 'Счёт №8', currencyId: 'rub', parentId2: '5', opportunity: '1000' } })
    expect(inv).toEqual({ id: 8, title: 'Счёт №8', currencyId: 'RUB', dealId: 5, opportunity: 1000 })
  })

  it('валюта не совпадает или нет сделки — останавливаемся до чтения задач', () => {
    const inv = parseInvoice({ item: { id: 8, currencyId: 'USD', parentId2: 0 } })!
    const problems = invoiceProblems(inv, { ...defaultSettings(), currency: 'RUB' }, 'deal')
    expect(problems).toHaveLength(2)
    expect(invoiceProblems(inv, defaultSettings(), 'invoice')).toEqual(['В настройках приложения не выбрана валюта ставок'])
  })
})
