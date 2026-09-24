import { describe, expect, it } from 'vitest'
import { applyMarkup, normalizePercent, resolveMarkup, type MarkupSettings } from '#shared/domain/markup'

// Пример из ТЗ: на всё 70 %, папка ЧЧ1 — 20 %, папка ЧЧ2 — 120 %, товар 1 — 25 %.
const settings: MarkupSettings = {
  defaultPercent: 70,
  sections: [{ id: 11, name: 'ЧЧ1', percent: 20 }, { id: 12, name: 'ЧЧ2', percent: 120 }],
  products: [{ id: 1, name: 'Товар 1', percent: 25 }]
}

describe('resolveMarkup — от частного к общему', () => {
  it('правило товара сильнее правила папки', () => {
    expect(resolveMarkup(settings, 1, [11])).toEqual({ percent: 25, source: 'product', ruleId: 1 })
  })

  it('ближайшая папка сильнее родительской', () => {
    // Товар лежит в ЧЧ2, а ЧЧ2 — внутри ЧЧ1.
    expect(resolveMarkup(settings, 5, [12, 11])).toEqual({ percent: 120, source: 'section', ruleId: 12 })
  })

  it('правило родительской папки действует на вложенные', () => {
    expect(resolveMarkup(settings, 5, [99, 11])).toEqual({ percent: 20, source: 'section', ruleId: 11 })
  })

  it('папки проверяются по цепочке по порядку: первое совпадение побеждает', () => {
    // Цепочка без правил на ближних уровнях: правило найдётся на третьем.
    expect(resolveMarkup(settings, 5, [98, 99, 12, 11])).toEqual({ percent: 120, source: 'section', ruleId: 12 })
    expect(resolveMarkup(settings, 5, [])).toEqual({ percent: 70, source: 'default', ruleId: 0 })
  })

  it('без товара и без совпадений — наценка «на всё»', () => {
    expect(resolveMarkup(settings, undefined, [11])).toEqual({ percent: 70, source: 'default', ruleId: 0 })
    expect(resolveMarkup(settings, 5, [99])).toEqual({ percent: 70, source: 'default', ruleId: 0 })
  })
})

describe('applyMarkup', () => {
  it('считает цену до копеек', () => {
    expect(applyMarkup(100, 70)).toBe(170)
    expect(applyMarkup(100, 120)).toBe(220)
    expect(applyMarkup(33.33, 20)).toBe(40)
    expect(applyMarkup(100, 0)).toBe(100)
  })

  it('округляет до копеек, а не до рублей (12,34 + 10 % = 13,57)', () => {
    expect(applyMarkup(12.34, 10)).toBe(13.57)
    expect(applyMarkup(0.01, 50)).toBe(0.02)
  })
})

describe('normalizePercent', () => {
  it('отвергает отрицательное и явные опечатки', () => {
    expect(normalizePercent('25,5')).toBe(25.5)
    expect(normalizePercent(-10)).toBeNull()
    expect(normalizePercent(10_001)).toBeNull()
  })
})
