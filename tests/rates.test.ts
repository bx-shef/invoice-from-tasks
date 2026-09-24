import { describe, expect, it } from 'vitest'
import { findRate, normalizeRate, parseRates, serializeRates, validateRates, type RateEntry } from '#shared/domain/rates'

const rates: RateEntry[] = [
  { userId: 7, rate: 100, from: '2026-01-01' },
  { userId: 7, rate: 120, from: '2026-06-01', productId: 55 },
  { userId: 9, rate: 80, from: '2026-03-15' }
]

describe('findRate — ставка, действующая на дату', () => {
  it('выбирает последнюю версию, начавшую действовать не позже даты', () => {
    expect(findRate(rates, 7, '2026-05-31')?.rate).toBe(100)
    expect(findRate(rates, 7, '2026-06-01')?.rate).toBe(120)
    expect(findRate(rates, 7, '2027-01-01')?.rate).toBe(120)
  })

  it('до первой версии ставки нет — это ошибка заполнения, а не ноль', () => {
    expect(findRate(rates, 9, '2026-03-14')).toBeNull()
    expect(findRate(rates, 404, '2026-06-01')).toBeNull()
  })
})

describe('хранение ставок', () => {
  it('сериализуется в компактные кортежи и читается обратно без потерь', () => {
    const json = serializeRates(rates)
    expect(json).toBe('[[7,100,"2026-01-01"],[7,120,"2026-06-01",55],[9,80,"2026-03-15"]]')
    expect(parseRates(json)).toEqual(rates)
  })

  it('битые записи отбрасываются, а не роняют разбор', () => {
    const parsed = parseRates([[7, 100, '2026-01-01'], ['x', 1, '2026-01-01'], [8, -1, '2026-01-01'], [8, 5, '2026-13-01'], 'мусор'])
    expect(parsed).toEqual([{ userId: 7, rate: 100, from: '2026-01-01' }])
    expect(parseRates('{не json')).toEqual([])
    expect(parseRates(null)).toEqual([])
  })

  it('дубль «сотрудник + дата» схлопывается в последнюю запись', () => {
    expect(parseRates([[7, 100, '2026-01-01'], [7, 150, '2026-01-01']])).toEqual([{ userId: 7, rate: 150, from: '2026-01-01' }])
  })
})

describe('validateRates', () => {
  it('находит все проблемы сразу, включая дубли', () => {
    const issues = validateRates([
      { userId: 7, rate: 100, from: '2026-01-01' },
      { userId: 7, rate: 110, from: '2026-01-01' },
      { userId: 0, rate: Number.NaN, from: '2026-02-30' }
    ])
    expect(issues.map(i => i.index)).toEqual([1, 2, 2, 2])
    expect(issues[0]?.message).toContain('Дубль')
  })

  it('чистая таблица — без замечаний', () => {
    expect(validateRates(rates)).toEqual([])
  })
})

describe('normalizeRate', () => {
  it('понимает запятую и режет до копеек', () => {
    expect(normalizeRate('12,345')).toBe(12.35)
    expect(normalizeRate(-1)).toBeNull()
    expect(normalizeRate(2_000_000)).toBeNull()
  })
})
