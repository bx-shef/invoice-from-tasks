import { describe, expect, it } from 'vitest'
import { cleanDecisionInput, decisionSummary, declinedText, mergeDecisions, parseDecisions, postponedText, postponeUntil, serializeDecisions } from '../shared/domain/decisions'

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

describe('отложить решение', () => {
  const now = new Date('2026-10-25T10:00:00Z')
  it('сроки: неделя, две, месяц, полгода', () => {
    expect(['1w', '2w', '1m', '6m'].map(p => postponeUntil(p as never, now))).toEqual(['2026-11-01', '2026-11-08', '2026-11-25', '2027-04-25'])
  })
  it('ввод: later:срок принимается, чужой срок — нет', () => {
    expect(cleanDecisionInput({ 1: 'later:2w', 2: 'later:3y', 3: 'later' }, [1, 2, 3])).toEqual({ 1: 'later:2w' })
  })
  it('слияние: отложено до даты, повтор того же — без изменений; разбор хранит until', () => {
    const { next, changed } = mergeDecisions({}, { 7: 'later:1w' }, now)
    expect(changed).toEqual([{ taskId: 7, d: 'later', until: '2026-11-01' }])
    expect(parseDecisions(serializeDecisions(next))[7]).toEqual({ d: 'later', at: now.toISOString(), until: '2026-11-01' })
    expect(mergeDecisions(next, { 7: 'later:1w' }, now).changed).toEqual([])
    expect(decisionSummary(next, [7])).toEqual({ yes: 0, no: 0, open: 1, allYes: false })
  })
  it('дело: задача и дата', () => {
    expect(postponedText([{ taskId: 7, until: '2026-11-01' }], new Map([[7, 'Импорт']]))).toBe('#7 Импорт — до 01.11.2026')
  })
})
