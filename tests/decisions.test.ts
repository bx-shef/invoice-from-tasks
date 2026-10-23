import { describe, expect, it } from 'vitest'
import { cleanDecisionInput, decisionSummary, declinedText, mergeDecisions, parseDecisions, serializeDecisions } from '../shared/domain/decisions'

describe('решения клиента по задачам', () => {
  it('разбор поля: JSON-строка или объект, мусор — пусто', () => {
    expect(parseDecisions('{"5":{"d":"yes","at":"t"},"x":{"d":"yes"},"6":{"d":"maybe"}}')).toEqual({ 5: { d: 'yes', at: 't' } })
    expect(parseDecisions('не json')).toEqual({})
    expect(parseDecisions(null)).toEqual({})
    expect(parseDecisions(serializeDecisions({ 7: { d: 'no', at: 'a' } }))).toEqual({ 7: { d: 'no', at: 'a' } })
  })

  it('ввод — только задачи этого счёта и только yes/no', () => {
    expect(cleanDecisionInput({ 1: 'yes', 2: 'no', 3: 'yes', 4: 'drop' }, [1, 2, 4])).toEqual({ 1: 'yes', 2: 'no' })
    expect(cleanDecisionInput({ 9: 'yes' }, [1])).toBeNull()
    expect(cleanDecisionInput([], [1])).toBeNull()
  })

  it('слияние: изменённые — с новой датой, повтор того же решения — без изменений', () => {
    const now = new Date('2026-10-23T10:00:00Z')
    const { next, changed } = mergeDecisions({ 1: { d: 'yes', at: 'old' } }, { 1: 'yes', 2: 'no' }, now)
    expect(next).toEqual({ 1: { d: 'yes', at: 'old' }, 2: { d: 'no', at: '2026-10-23T10:00:00.000Z' } })
    expect(changed).toEqual([{ taskId: 2, d: 'no' }])
  })

  it('итог: все подтверждены — только когда решение «yes» у каждой задачи счёта', () => {
    expect(decisionSummary({ 1: { d: 'yes', at: '' }, 2: { d: 'no', at: '' } }, [1, 2, 3])).toEqual({ yes: 1, no: 1, open: 1, allYes: false })
    expect(decisionSummary({ 1: { d: 'yes', at: '' }, 2: { d: 'yes', at: '' } }, [1, 2]).allYes).toBe(true)
    expect(decisionSummary({}, []).allYes).toBe(false)
  })

  it('текст дела об отказе — номер и название задачи', () => {
    expect(declinedText([2, 3], new Map([[2, 'Отчёт']]))).toBe('#2 Отчёт\n#3')
  })
})
