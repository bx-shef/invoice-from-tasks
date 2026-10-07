import { describe, expect, it } from 'vitest'
import { flagOf, invoiceEconomy, parseInvoiceEconomy, taskEconomics, taskFieldValues } from '#shared/domain/economics'
import { buildEstimateMessages, MAX_ESTIMATE_HOURS, parseEstimateItems, pickEstimates } from '#shared/domain/estimate'
import { moneyOf } from '#shared/domain/tasks'
import type { DraftRow } from '#shared/domain/fill'

const row = (taskId: number, formulaSum: number, sum: number, estimated = false) => ({ taskId, formulaSum, sum, estimated }) as unknown as DraftRow

describe('экономика задач', () => {
  it('дельта = выставлено − формула, разница — % к формуле; строки задачи складываются', () => {
    const list = taskEconomics({ rows: [row(1, 1000, 800), row(2, 500, 300), row(2, 500, 700)], errors: [] }, 20)
    expect(list[0]).toMatchObject({ taskId: 1, formula: 1000, billed: 800, delta: -200, diffPercent: -20, flag: null })
    expect(list[1]).toMatchObject({ taskId: 2, formula: 1000, billed: 1000, delta: 0, diffPercent: 0, flag: null })
  })

  it('пометки по порогу: убыток и завышение СТРОГО больше порога; оценка ИИ и нет формулы — нет данных', () => {
    expect(flagOf(-20, false, 20)).toBeNull()
    expect(flagOf(-20.1, false, 20)).toBe('loss')
    expect(flagOf(20.1, false, 20)).toBe('over')
    expect(flagOf(50, true, 20)).toBe('missing')
    expect(flagOf(null, false, 20)).toBe('missing')
  })

  it('задача с ошибкой сборки (нет ставки) — в списке с пометкой «нет данных»', () => {
    const list = taskEconomics({ rows: [row(1, 100, 100)], errors: [{ taskId: 5, message: 'нет ставки' }, { taskId: 0, message: 'счёт' }] }, 20)
    expect(list.map(e => [e.taskId, e.flag])).toEqual([[1, null], [5, 'missing']])
  })

  it('поля задачи: разница пустая, если формулы нет; не выбранные поля не пишем', () => {
    const [e] = taskEconomics({ rows: [row(1, 0, 500, true)], errors: [] }, 20)
    expect(taskFieldValues(e!, { diffPercent: 'UF_D', delta: 'UF_X' })).toEqual({ UF_D: '', UF_X: 500 })
    expect(taskFieldValues(e!, { diffPercent: '', delta: '' })).toEqual({})
  })

  it('итог счёта: прибыль или убыток, счётчики пометок, JSON читается обратно', () => {
    const list = taskEconomics({ rows: [row(1, 1000, 500), row(2, 1000, 1500), row(3, 0, 300, true)], errors: [] }, 20)
    const econ = invoiceEconomy(list, { at: new Date('2026-10-07T10:00:00Z'), currency: 'BYN', source: 'deal', mode: 'task', threshold: 20, titles: new Map([[1, 'Лендинг']]) })
    expect(econ).toMatchObject({ formula: 2000, billed: 2300, delta: 300, diffPercent: 15, verdict: 'profit', counts: { loss: 1, over: 1, missing: 1 } })
    expect(econ.tasks[0]).toMatchObject({ taskId: 1, title: 'Лендинг', flag: 'loss' })
    expect(parseInvoiceEconomy(JSON.stringify(econ))).toEqual(econ)
    expect(parseInvoiceEconomy('{"v":2}')).toBeNull()
    expect(parseInvoiceEconomy('не json')).toBeNull()
  })
})

describe('стоимость работ из поля задачи', () => {
  it('число, строка с запятой и пробелами, «Деньги» с валютой; мусор и минус — null', () => {
    expect(moneyOf(1200.5)).toBe(1200.5)
    expect(moneyOf('1 200,50')).toBe(1200.5)
    expect(moneyOf('1200|BYN')).toBe(1200)
    expect(moneyOf(['300'])).toBe(300)
    expect(moneyOf('')).toBeNull()
    expect(moneyOf('abc')).toBeNull()
    expect(moneyOf(-5)).toBeNull()
  })
})

describe('оценка часов ИИ', () => {
  it('промпт: без завышений, хороший ИИ-агент, ответ JSON; текст задач урезан', () => {
    const [system, user] = buildEstimateMessages([{ key: 't1', title: 'Лендинг', description: 'x'.repeat(5000), hourPrice: 100 }])
    expect(system!.content).toMatch(/без завышений/)
    expect(system!.content).toMatch(/ИИ-агентом/)
    expect(user!.content.length).toBeLessThan(2000)
  })

  it('ответ: только известные ключи, шаг 0,25, потолок, ноль и мусор — мимо', () => {
    const got = pickEstimates({ estimates: [{ key: 't1', hours: 1.3 }, { key: 't2', hours: 0 }, { key: 't9', hours: 2 }, { key: 't3', hours: 9999 }, { key: 't4', hours: 'x' }] }, ['t1', 't2', 't3', 't4'])
    expect(got).toEqual({ t1: 1.25, t3: MAX_ESTIMATE_HOURS })
  })

  it('запрос: ключи t<ID>, не больше 25 задач', () => {
    expect(parseEstimateItems({ items: [{ key: 't5', title: 'A' }] })).toEqual([{ key: 't5', title: 'A', description: '', hourPrice: 0 }])
    expect(parseEstimateItems({ items: [{ key: 'x5', title: 'A' }] })).toBeNull()
    expect(parseEstimateItems({ items: Array.from({ length: 26 }, (_, i) => ({ key: `t${i}`, title: 'A' })) })).toBeNull()
    expect(parseEstimateItems({})).toBeNull()
  })
})
