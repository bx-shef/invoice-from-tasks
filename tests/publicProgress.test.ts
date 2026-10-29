import { describe, expect, it } from 'vitest'
import { decisionProgress, ofWorksLabel, rowCode, rowTitle, waitingLabel, worksLabel } from '../app/utils/publicProgress'

describe('decisionProgress', () => {
  const rows = [{ taskId: 1, sum: 100.1 }, { taskId: 2, sum: 50 }, { taskId: 1, sum: 0.2 }, { taskId: null, sum: 999 }, { taskId: 3, sum: null }]
  it('считает доли и сумму принятого', () => {
    const p = decisionProgress([1, 2, 3, 4], { 1: 'yes', 2: 'no', 3: 'later' }, rows)
    expect(p).toEqual({ yes: 1, no: 1, later: 1, wait: 1, all: 4, decided: 2, acceptedSum: 100.3 })
  })
  it('без решений — всё ждёт, к оплате ноль', () => {
    expect(decisionProgress([1, 2], {}, rows)).toMatchObject({ wait: 2, decided: 0, acceptedSum: 0 })
  })
  it('решения по задачам вне списка не считаются', () => {
    expect(decisionProgress([2], { 1: 'yes', 2: 'yes' }, rows)).toMatchObject({ yes: 1, acceptedSum: 50 })
  })
})

describe('worksLabel', () => {
  it.each([[1, '1 работа'], [3, '3 работы'], [5, '5 работ'], [11, '11 работ'], [21, '21 работа'], [12, '12 работ'], [22, '22 работы']])('%i', (n, s) => {
    expect(worksLabel(n)).toBe(s)
  })
})

describe('ofWorksLabel', () => {
  it.each([[1, '1 работы'], [2, '2 работ'], [5, '5 работ'], [11, '11 работ'], [21, '21 работы']])('%i', (n, s) => {
    expect(ofWorksLabel(n)).toBe(s)
  })
})

describe('waitingLabel', () => {
  it.each([[1, '1 работа ждёт решения'], [3, '3 работы ждут решения'], [5, '5 работ ждут решения'], [21, '21 работа ждёт решения']])('%i', (n, s) => {
    expect(waitingLabel(n)).toBe(s)
  })
  it('пустой список', () => {
    expect(decisionProgress([], {}, [])).toMatchObject({ all: 0, wait: 0, decided: 0, acceptedSum: 0 })
  })
})

describe('rowCode / rowTitle', () => {
  it('разбирает приставку', () => {
    expect(rowCode('[87-119884] Импорт')).toBe('87-119884')
    expect(rowTitle('[87-119884] Импорт')).toBe('Импорт')
  })
  it('без приставки', () => {
    expect(rowCode('Импорт [x]')).toBe('')
    expect(rowTitle('Импорт [x]')).toBe('Импорт [x]')
  })
  it('только приставка — название не пустеет', () => {
    expect(rowTitle('[1-2]')).toBe('[1-2]')
  })
})
