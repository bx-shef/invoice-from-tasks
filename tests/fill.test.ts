import { describe, expect, it } from 'vitest'
import { applyNames, buildRows, clampName, MAX_ROW_NAME, rowsTotal, toProductRows, type FillInput } from '#shared/domain/fill'
import { defaultSettings, type AppSettings } from '#shared/domain/settings'
import type { TaskInfo, TimeEntry } from '#shared/domain/tasks'

function settings(patch: Partial<AppSettings> = {}): AppSettings {
  return { ...defaultSettings(), currency: 'RUB', ...patch }
}

const task: TaskInfo = {
  id: 10,
  title: 'Сверстать лендинг',
  description: 'Макет в Figma',
  responsibleId: 7,
  crmBindings: ['D_5'],
  timeSpentInLogs: 5400
}

const entries: TimeEntry[] = [
  { id: 101, taskId: 10, userId: 7, seconds: 3600, comment: 'Вёрстка шапки', date: '2026-05-10' },
  { id: 102, taskId: 10, userId: 9, seconds: 1800, comment: 'Правки по макету', date: '2026-06-02' }
]

function input(patch: Partial<FillInput> = {}): FillInput {
  return {
    mode: 'task',
    tasks: [task],
    entries,
    rates: [
      { userId: 7, rate: 100, from: '2026-01-01' },
      { userId: 7, rate: 200, from: '2026-06-01' },
      // Версия из будущего: работы 2026 года по ней считаться не должны.
      { userId: 7, rate: 999, from: '2027-01-01' },
      { userId: 9, rate: 80, from: '2026-01-01' }
    ],
    settings: settings(),
    products: new Map(),
    ...patch
  }
}

describe('тип 1 — задача как строка', () => {
  it('всё время задачи × ставка ответственного на дату последней записи', () => {
    const { rows, errors } = buildRows(input())
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    // 1,5 ч всех участников, ставка ответственного #7 на 2026-06-02 — 200.
    expect(rows[0]).toMatchObject({ key: 't10', name: 'Сверстать лендинг', quantity: 1.5, baseRate: 200, rateDate: '2026-06-02', price: 200, sum: 300 })
  })

  it('округление применяется к сумме времени задачи', () => {
    const { rows } = buildRows(input({ settings: settings({ rounding: 60 }) }))
    expect(rows[0]?.quantity).toBe(2)
  })

  it('нет ставки ответственного — ошибка, строки нет', () => {
    const { rows, errors } = buildRows(input({ rates: [{ userId: 9, rate: 80, from: '2026-01-01' }] }))
    expect(rows).toEqual([])
    expect(errors[0]?.message).toBe('нет ставки для #7 на 2026-06-02')
  })

  it('имя сотрудника в ошибке, если оно известно', () => {
    const { errors } = buildRows(input({ rates: [], userNames: new Map([[7, 'Иван Петров']]) }))
    expect(errors[0]?.message).toContain('Иван Петров')
  })

  it('задача без времени — ошибка «нет затраченного времени»', () => {
    const { errors } = buildRows(input({ entries: [], tasks: [{ ...task, timeSpentInLogs: 0 }] }))
    expect(errors).toEqual([{ taskId: 10, message: 'в задаче нет затраченного времени' }])
  })

  it('время в задаче есть, а записей не видно — говорим про доступ, а не «нет времени»', () => {
    const { errors } = buildRows(input({ entries: [] }))
    expect(errors[0]?.message).toContain('не прочитан')
  })

  it('наценка из настроек идёт в цену', () => {
    const s = settings({ markup: { defaultPercent: 70, sections: [], products: [] } })
    const { rows } = buildRows(input({ settings: s }))
    expect(rows[0]).toMatchObject({ price: 340, markupPercent: 70, markupSource: 'default', sum: 510 })
  })

  it('товар из ставки и наценка по его папке', () => {
    const s = settings({ markup: { defaultPercent: 70, sections: [{ id: 3, name: 'ЧЧ1', percent: 20 }], products: [] } })
    const { rows } = buildRows(input({
      settings: s,
      rates: [{ userId: 7, rate: 100, from: '2026-01-01', productId: 55 }],
      products: new Map([[55, { sectionChain: [3] }]])
    }))
    expect(rows[0]).toMatchObject({ productId: 55, price: 120, markupSource: 'section' })
  })
})

describe('тип 2 — записи времени как строки', () => {
  it('строка на запись, ставка того, кто списал время, на дату записи', () => {
    const { rows, errors } = buildRows(input({ mode: 'time' }))
    expect(errors).toEqual([])
    expect(rows.map(r => [r.key, r.name, r.quantity, r.price, r.sum])).toEqual([
      ['e101', 'Вёрстка шапки', 1, 100, 100],
      ['e102', 'Правки по макету', 0.5, 80, 40]
    ])
    expect(rowsTotal(rows)).toBe(140)
  })

  it('запись без описания — ошибка: строку нечем назвать', () => {
    const { errors } = buildRows(input({ mode: 'time', entries: [{ ...entries[0]!, comment: '' }] }))
    expect(errors[0]).toMatchObject({ taskId: 10, entryId: 101 })
    expect(errors[0]?.message).toContain('нет описания')
  })

  it('нулевая запись пропускается с предупреждением, а не ошибкой', () => {
    const { rows, errors, warnings } = buildRows(input({ mode: 'time', entries: [...entries, { ...entries[0]!, id: 103, seconds: 0 }] }))
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(warnings).toHaveLength(1)
  })

  it('ошибки собираются по всем записям сразу', () => {
    const { errors } = buildRows(input({ mode: 'time', rates: [] }))
    expect(errors).toHaveLength(2)
  })
})

describe('общие правила', () => {
  it('ни одной задачи — ошибка', () => {
    expect(buildRows(input({ tasks: [] })).errors[0]?.message).toBe('не найдено ни одной задачи')
  })

  it('длинное название обрезается до 255 символов', () => {
    const { rows } = buildRows(input({ tasks: [{ ...task, title: 'а'.repeat(400) }] }))
    expect(rows[0]?.name).toHaveLength(255)
  })

  it('clampName: ровно предел — без изменений, на символ больше — с многоточием', () => {
    expect(MAX_ROW_NAME).toBe(255)
    const exact = 'я'.repeat(MAX_ROW_NAME)
    expect(clampName(exact)).toBe(exact)
    const over = clampName(`${exact}ы`)
    expect(over).toHaveLength(MAX_ROW_NAME)
    expect(over.endsWith('…')).toBe(true)
    expect(clampName('  две\n строки\t ')).toBe('две строки')
  })
})

describe('applyNames — названия от BitrixGPT', () => {
  it('подставляет по ключу, а пропуск — ошибка, не тихий откат', () => {
    const { rows } = buildRows(input({ mode: 'time' }))
    const named = applyNames(rows, { e101: 'Вёрстка шапки сайта' })
    expect(named.rows[0]?.name).toBe('Вёрстка шапки сайта')
    expect(named.errors).toEqual([{ taskId: 10, entryId: 102, message: 'BitrixGPT не вернул название строки' }])
  })
})

describe('toProductRows — поля crm.item.productrow.*', () => {
  it('передаёт товар, единицу измерения и сортировку после существующих строк', () => {
    const { rows } = buildRows(input({ rates: [{ userId: 7, rate: 100, from: '2026-01-01', productId: 55 }] }))
    expect(toProductRows(rows, settings({ measureCode: 356 }), 30)).toEqual([
      { productId: 55, productName: 'Сверстать лендинг', price: 100, quantity: 1.5, measureCode: 356, sort: 40 }
    ])
  })
})
