import { describe, expect, it } from 'vitest'
import { OKEI_NAMES, parseMeasures } from '~/utils/measures'

// Ответ catalog.measure.list с тестового портала (замер 2026-09-24): у системных единиц
// measureTitle и symbol — null, заполнены только международные обозначения.
const live = [
  { code: 6, id: 1, isDefault: 'N', measureTitle: null, symbol: null, symbolIntl: 'm', symbolLetterIntl: 'MTR' },
  { code: 796, id: 9, isDefault: 'Y', measureTitle: null, symbol: null, symbolIntl: 'pc. 1', symbolLetterIntl: 'PCE. NMB' }
]

describe('parseMeasures', () => {
  it('без названия у портала — название из ОКЕИ по коду', () => {
    expect(parseMeasures(live)).toEqual([{ code: 6, title: 'Метр' }, { code: 796, title: 'Штука' }])
  })

  it('своё название портала сильнее ОКЕИ; затем symbol', () => {
    expect(parseMeasures([{ code: 796, measureTitle: ' Шт. ' }, { code: 356, symbol: 'ч' }]))
      .toEqual([{ code: 796, title: 'Шт.' }, { code: 356, title: 'ч' }])
  })

  it('кода нет в ОКЕИ-справочнике — международное обозначение, затем «код N»', () => {
    expect(parseMeasures([{ code: 5000, symbolIntl: 'box' }, { code: 5001, symbolLetterIntl: 'BX' }, { code: 5002 }]))
      .toEqual([{ code: 5000, title: 'box' }, { code: 5001, title: 'BX' }, { code: 5002, title: 'код 5002' }])
  })

  it('запись без положительного целого кода и мусор отбрасываются', () => {
    expect(parseMeasures([{ code: 0 }, { code: '1.5' }, null, 'x', { measureTitle: 'Час' }])).toEqual([])
    expect(parseMeasures({ measures: [] })).toEqual([])
  })

  it('в справочнике есть час — единица для строк по времени', () => {
    expect(OKEI_NAMES[356]).toBe('Час')
  })
})
