import { describe, expect, it } from 'vitest'
import { canEditRates, defaultSettings, parseSettings, serializeSettings } from '#shared/domain/settings'

describe('parseSettings — защитный разбор app.option', () => {
  it('мусор и пустота дают настройки по умолчанию', () => {
    expect(parseSettings(undefined)).toEqual(defaultSettings())
    expect(parseSettings('{битый json')).toEqual(defaultSettings())
    expect(parseSettings([1, 2])).toEqual(defaultSettings())
  })

  it('читает корректные поля и нормализует их', () => {
    const s = parseSettings(JSON.stringify({
      rounding: 30,
      currency: 'rub',
      rateEditors: [5, '6', 5, -1, 'x'],
      roundingDirection: 'nearest',
      markup: { defaultPercent: '70', tags: [{ tag: ' ЧЧ1 ', percent: 20 }, { tag: 'ЧЧ2', percent: '120' }] },
      naming: 'ai',
      prompts: { taskTitle: '  свой промпт  ', timeBlock: '' }
    }))
    expect(s.rounding).toBe(30)
    expect(s.currency).toBe('RUB')
    expect(s.rateEditors).toEqual([5, 6])
    expect(s.roundingDirection).toBe('nearest')
    expect(s.markup).toEqual({ defaultPercent: 70, tags: [{ tag: 'ЧЧ1', percent: 20 }, { tag: 'ЧЧ2', percent: 120 }] })
    expect(s.naming).toBe('ai')
    expect(s.prompts).toEqual({ taskTitle: 'свой промпт', timeBlock: null })
  })

  it('недопустимый шаг и направление округления, валюта отбрасываются', () => {
    const s = parseSettings({ rounding: 15, roundingDirection: 'down', currency: 'RUBLES' })
    expect(s.rounding).toBe(0)
    expect(s.roundingDirection).toBe('up')
    expect(s.currency).toBe('')
  })

  it('правила по тегам: порядок сохраняется, пустые, битые и повторы тега отбрасываются', () => {
    const s = parseSettings({ markup: { defaultPercent: 10, tags: [
      { tag: 'Срочно', percent: 50 },
      { tag: '  ', percent: 5 },
      { tag: 'Дизайн', percent: -1 },
      { tag: '#срочно', percent: 70 },
      { tag: 'x'.repeat(101), percent: 5 },
      'мусор',
      { tag: 'Дизайн', percent: 30 }
    ] } })
    expect(s.markup.tags).toEqual([{ tag: 'Срочно', percent: 50 }, { tag: 'Дизайн', percent: 30 }])
  })

  it('тег правила хранится без # в начале; ровно 100 символов — допустимо', () => {
    const exact = 'т'.repeat(100)
    const s = parseSettings({ markup: { tags: [{ tag: ' ##Срочно ', percent: 5 }, { tag: exact, percent: 1 }] } })
    expect(s.markup.tags).toEqual([{ tag: 'Срочно', percent: 5 }, { tag: exact, percent: 1 }])
  })

  it('правила — не массив (объект, строка) — правил нет', () => {
    expect(parseSettings({ markup: { tags: { tag: 'срочно', percent: 5 } } }).markup.tags).toEqual([])
    expect(parseSettings({ markup: { tags: 'срочно' } }).markup.tags).toEqual([])
  })

  it('настройки до #3 (наценки по папкам и товарам, товар строк) читаются без них', () => {
    const s = parseSettings({ markup: { defaultPercent: 70, sections: [{ id: 11, name: 'ЧЧ1', percent: 20 }], products: [] }, defaultProductId: 5 })
    expect(s.markup).toEqual({ defaultPercent: 70, tags: [] })
    expect(s).not.toHaveProperty('defaultProductId')
  })

  it('не переносит посторонние ключи, в том числе __proto__', () => {
    const s = parseSettings('{"__proto__":{"polluted":true},"evil":1}') as unknown as Record<string, unknown>
    expect(s.evil).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('промпты консультаций без заголовка, текста или с дублем id отбрасываются', () => {
    const s = parseSettings({ consultPrompts: [
      { id: 'a', title: 'Риски', text: 'Оцени риски' },
      { id: 'a', title: 'Дубль', text: 'x' },
      { id: 'b', title: '', text: 'x' },
      { id: 'c<script>', title: 'Сроки', text: 'Оцени сроки' }
    ] })
    expect(s.consultPrompts.map(p => p.id)).toEqual(['a', 'cscript'])
  })

  it('сериализация идемпотентна', () => {
    const once = serializeSettings(parseSettings({ rounding: 10, currency: 'BYN' }))
    expect(serializeSettings(parseSettings(once))).toBe(once)
  })
})

describe('canEditRates', () => {
  it('администратор и назначенные редакторы — да, остальные — нет', () => {
    const s = parseSettings({ rateEditors: [5] })
    expect(canEditRates(s, 1, true)).toBe(true)
    expect(canEditRates(s, 5, false)).toBe(true)
    expect(canEditRates(s, 6, false)).toBe(false)
  })
})
