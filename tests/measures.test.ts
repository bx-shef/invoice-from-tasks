import { describe, expect, it } from 'vitest'
import { hourInSumMode, MAX_MEASURE_TITLE, measureItems, measureMissing, measureSymbol, OKEI_NAMES, OKEI_SYMBOLS, parseMeasures, rowUnit, type MeasureOption } from '~/utils/measures'

// Ответ catalog.measure.list с тестового портала (замер 2026-09-24): у системных единиц
// measureTitle и symbol — null, заполнены только международные обозначения.
const live = [
  { code: 6, id: 1, isDefault: 'N', measureTitle: null, symbol: null, symbolIntl: 'm', symbolLetterIntl: 'MTR' },
  { code: 796, id: 9, isDefault: 'Y', measureTitle: null, symbol: null, symbolIntl: 'pc. 1', symbolLetterIntl: 'PCE. NMB' }
]

const titles = (raw: unknown) => parseMeasures(raw).map(m => [m.code, m.title])

describe('parseMeasures', () => {
  it('без названия у портала — название из ОКЕИ по коду, подпись с кодом', () => {
    expect(parseMeasures(live)).toEqual([
      { code: 6, title: 'Метр', label: 'Метр (код 6)', symbol: 'м', isDefault: false },
      { code: 796, title: 'Штука', label: 'Штука (код 796)', symbol: 'шт', isDefault: true }
    ])
  })

  it('своё название портала сильнее ОКЕИ; затем symbol', () => {
    expect(titles([{ code: 796, measureTitle: ' Шт. ' }, { code: 356, symbol: 'ч' }])).toEqual([[796, 'Шт.'], [356, 'ч']])
  })

  it('в ОДНОЙ записи: measureTitle сильнее symbol, symbolIntl сильнее symbolLetterIntl', () => {
    expect(titles([
      { code: 5000, measureTitle: 'Коробка', symbol: 'кор' },
      { code: 5001, symbolIntl: 'box', symbolLetterIntl: 'BX' }
    ])).toEqual([[5000, 'Коробка'], [5001, 'box']])
  })

  it('название из одних пробелов — как нет названия: дальше по цепочке', () => {
    expect(titles([{ code: 796, measureTitle: '   ', symbol: '' }])).toEqual([[796, 'Штука']])
  })

  it('кода нет в ОКЕИ — международное обозначение; без названия — подпись только «код N»', () => {
    expect(parseMeasures([{ code: 5000, symbolIntl: 'box' }, { code: 5001, symbolLetterIntl: 'BX' }, { code: 5002 }])).toEqual([
      { code: 5000, title: 'box', label: 'box (код 5000)', symbol: '', isDefault: false },
      { code: 5001, title: 'BX', label: 'BX (код 5001)', symbol: '', isDefault: false },
      { code: 5002, title: '', label: 'код 5002', symbol: '', isDefault: false }
    ])
  })

  it('код строкой — как в других ответах REST; мусор и не целые коды отбрасываются', () => {
    expect(titles([{ code: '796' }])).toEqual([[796, 'Штука']])
    expect(parseMeasures([{ code: 0 }, { code: '1.5' }, { code: -6 }, null, 'x', { measureTitle: 'Час' }])).toEqual([])
    expect(parseMeasures({ measures: [] })).toEqual([])
  })

  it('длинное название обрезается до предела', () => {
    const [m] = parseMeasures([{ code: 5000, measureTitle: 'я'.repeat(MAX_MEASURE_TITLE + 50) }])
    expect(m?.title).toHaveLength(MAX_MEASURE_TITLE)
  })

  it('в справочнике есть час — единица для строк по времени', () => {
    expect(OKEI_NAMES[356]).toBe('Час')
  })
})

describe('measureSymbol — единица в столбце «Количество» предпросмотра', () => {
  it('знакомый код — краткое обозначение, как в счёте', () => {
    expect(measureSymbol(356)).toBe('ч')
    expect(measureSymbol(796)).toBe('шт')
  })

  it('единица не задана или код незнакомый — пусто: портал поставит свою, выдумывать не будем', () => {
    expect(measureSymbol(null)).toBe('')
    expect(measureSymbol(undefined)).toBe('')
    expect(measureSymbol(0)).toBe('')
    expect(measureSymbol(5002)).toBe('')
  })

  it('у каждого кода с названием есть обозначение', () => {
    expect(Object.keys(OKEI_SYMBOLS).sort()).toEqual(Object.keys(OKEI_NAMES).sort())
  })
})

describe('обозначение единицы в строке счёта (symbol)', () => {
  it('своя единица портала — её symbol (замер 2026-09-28: «чел.-ч» → в строке «чел.-ч»)', () => {
    const [m] = parseMeasures([{ code: 9990, measureTitle: 'Человеко-час', symbol: ' чел.-ч ', isDefault: 'N' }])
    expect(m).toMatchObject({ symbol: 'чел.-ч', isDefault: false })
  })

  it('системная (symbol — null) — из ОКЕИ; незнакомый код без symbol — пусто, международное не подставляем', () => {
    expect(parseMeasures([{ code: 796, symbol: null, symbolIntl: 'pc. 1' }])[0]!.symbol).toBe('шт')
    expect(parseMeasures([{ code: 5002, symbolIntl: 'box' }])[0]!.symbol).toBe('')
  })

  it('признак «по умолчанию» — Y или true; прочее — нет', () => {
    expect(parseMeasures([{ code: 1, isDefault: 'Y' }, { code: 2, isDefault: true }, { code: 3, isDefault: 'N' }, { code: 4 }]).map(m => m.isDefault))
      .toEqual([true, true, false, false])
  })
})

/** Справочник тестового портала (замер 2026-09-28) плюс своя единица смока. */
const portal: MeasureOption[] = parseMeasures([
  ...live,
  { code: 9990, measureTitle: 'IFT smoke: человеко-час', symbol: 'чел.-ч', isDefault: 'N' }
])

describe('rowUnit — какая единица окажется в строках счёта', () => {
  it('код есть в справочнике — его обозначение, без предупреждения', () => {
    expect(rowUnit(portal, 796)).toEqual({ symbol: 'шт', notice: null })
    expect(rowUnit(portal, 9990)).toEqual({ symbol: 'чел.-ч', notice: null })
  })

  it('единица не задана — портал ставит единицу по умолчанию (замер: «шт»)', () => {
    expect(rowUnit(portal, null)).toEqual({ symbol: 'шт', notice: null })
  })

  it('кода нет в справочнике — портал молча пишет единицу по умолчанию (замер: 356 → «шт»): показываем её и предупреждаем', () => {
    expect(rowUnit(portal, 356)).toEqual({
      symbol: 'шт',
      notice: 'Единицы с кодом 356 из настроек нет в справочнике портала — портал запишет в строки единицу по '
        + 'умолчанию «Штука». Администратор выбирает единицу в «Настройки → Общие».'
    })
  })

  it('справочник не прочитан (нет права каталога) или пуст — обозначение из ОКЕИ по коду, без предупреждения', () => {
    expect(rowUnit(null, 356)).toEqual({ symbol: 'ч', notice: null })
    expect(rowUnit([], 356)).toEqual({ symbol: 'ч', notice: null })
    expect(rowUnit(null, 9990)).toEqual({ symbol: '', notice: null })
    expect(rowUnit(null, null)).toEqual({ symbol: '', notice: null })
  })

  it('в справочнике нет единицы по умолчанию — обозначения нет, предупреждение без названия', () => {
    const noDefault = portal.map(m => ({ ...m, isDefault: false }))
    expect(rowUnit(noDefault, null)).toEqual({ symbol: '', notice: null })
    expect(rowUnit(noDefault, 356).notice).toContain('запишет в строки единицу по умолчанию. ')
  })
})

describe('measureMissing — сохранённой единицы нет в справочнике', () => {
  it('нет в прочитанном справочнике — да; есть, не задана или справочник не прочитан — нет', () => {
    expect(measureMissing(portal, 356)).toBe(true)
    expect(measureMissing(portal, 796)).toBe(false)
    expect(measureMissing(portal, null)).toBe(false)
    expect(measureMissing(null, 356)).toBe(false)
    // Пустой ответ — «не прочитан», а не «единиц нет»: у портала единица по умолчанию есть всегда.
    expect(measureMissing([], 356)).toBe(false)
  })
})

describe('measureItems — список единиц в настройках', () => {
  it('единицы справочника; сохранённый код не из справочника — в конце с пометкой', () => {
    expect(measureItems(portal, 796).map(i => i.value)).toEqual([6, 796, 9990])
    expect(measureItems(portal, 356).at(-1)).toEqual({ label: 'код 356 — нет в справочнике', value: 356 })
  })

  it('справочник не прочитан — только сохранённый код, без пометки; ничего не сохранено — пусто', () => {
    expect(measureItems(null, 356)).toEqual([{ label: 'код 356', value: 356 }])
    expect(measureItems(null, null)).toEqual([])
    expect(measureItems([], 356)).toEqual([{ label: 'код 356', value: 356 }])
    expect(measureItems(portal, null)).toHaveLength(3)
  })
})

describe('hourInSumMode — «час» при «сумма × 1»', () => {
  it('только сумма строки и единица «час» (356): в счёте было бы «1 час» за всю работу', () => {
    expect(hourInSumMode('sum', 356)).toBe(true)
    expect(hourInSumMode('hour', 356)).toBe(false)
    expect(hourInSumMode('sum', 796)).toBe(false)
    expect(hourInSumMode('sum', null)).toBe(false)
  })
})
