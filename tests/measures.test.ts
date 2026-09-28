import { describe, expect, it } from 'vitest'
import { hourInSumMode, MAX_MEASURE_TITLE, measureItems, measureMissing, measureSymbol, readMeasures, OKEI_NAMES, OKEI_SYMBOLS, parseMeasures, rowUnit, type MeasureOption } from '~/utils/measures'

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

  it('справочник не ответил в срок — обозначение из ОКЕИ и честное предупреждение; без кода — молча', () => {
    expect(rowUnit(null, 356, 'timeout')).toEqual({
      symbol: 'ч',
      notice: 'Справочник единиц портала не ответил вовремя — единица показана по коду; если её нет в справочнике, '
        + 'портал запишет единицу по умолчанию. Проверьте единицу в счёте после записи.'
    })
    expect(rowUnit(null, null, 'timeout')).toEqual({ symbol: '', notice: null })
    expect(rowUnit(portal, 796, 'timeout')).toEqual({ symbol: 'шт', notice: null })
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

  it('своя часовая единица справочника — по обозначению или по названию, каждое само по себе', () => {
    const own = parseMeasures([
      { code: 9990, measureTitle: 'Работа специалиста', symbol: 'чел.-ч' },
      { code: 9991, measureTitle: 'Час работы', symbol: 'чр' },
      { code: 9994, measureTitle: 'Единица времени', symbol: 'ч.' },
      { code: 9995, symbolIntl: 'man-h' },
      { code: 539 }
    ])
    for (const code of [9990, 9991, 9994, 9995, 539]) expect(hourInSumMode('sum', code, own), String(code)).toBe(true)
    expect(hourInSumMode('hour', 9990, own)).toBe(false)
    // Справочник не прочитан — узнать свою единицу нечем, только код ОКЕИ.
    expect(hourInSumMode('sum', 9990, null)).toBe(false)
  })

  it('не час: слово «час» внутри другого, скорость «км/ч», прочие единицы', () => {
    const titles = ['Часть', 'Участок', 'Запчасть', 'Часы', 'Чашка', 'Мяч', 'Штука']
    const other = parseMeasures([
      ...titles.map((title, i): Record<string, unknown> => ({ code: 9100 + i, measureTitle: title })),
      { code: 9200, measureTitle: 'Скорость', symbol: 'км/ч' },
      { code: 9201, measureTitle: 'Расход', symbol: 'м3/ч' }
    ])
    for (const m of other) expect(hourInSumMode('sum', m.code, other), m.title).toBe(false)
  })

  it('356 из прочитанного справочника пропал — не «час»: портал запишет единицу по умолчанию', () => {
    expect(hourInSumMode('sum', 356, portal)).toBe(false)
    expect(hourInSumMode('sum', 356, parseMeasures([{ code: 356, isDefault: 'N' }, { code: 796, isDefault: 'Y' }]))).toBe(true)
  })
})

describe('readMeasures — весь справочник постранично (страница и смок)', () => {
  const unit = (code: number) => ({ code, measureTitle: `u${code}` })

  it('листает по start, пока страница полная (замер: 61 единица → 50 и 11), и разбирает всё', async () => {
    const all = Array.from({ length: 61 }, (_, i) => unit(9000 + i))
    const starts: number[] = []
    const measures = await readMeasures(async (start) => {
      starts.push(start)
      return { measures: all.slice(start, start + 50) }
    }, 50, 1000)
    expect(starts).toEqual([0, 50])
    expect(measures.map(m => m.code)).toEqual(all.map(u => u.code))
  })

  it('ответ без списка — ошибка («не прочитан»), в том числе на второй странице: без молча обрезанного справочника', async () => {
    await expect(readMeasures(async () => ({ measures: { 0: unit(6) } }), 50, 1000)).rejects.toThrow('ответ без списка единиц (start 0)')
    await expect(readMeasures(async () => null, 50, 1000)).rejects.toThrow('ответ без списка единиц')
    const firstFull = Array.from({ length: 50 }, (_, i) => unit(9000 + i))
    await expect(readMeasures(async start => (start === 0 ? { measures: firstFull } : { error: 'x' }), 50, 1000))
      .rejects.toThrow('(start 50)')
  })

  it('записи разобраны (название из ОКЕИ, обозначение, «по умолчанию»), а не отданы как есть', async () => {
    const measures = await readMeasures(async () => ({ measures: live }), 50, 1000)
    expect(measures).toEqual(parseMeasures(live))
    expect(measures[1]).toMatchObject({ title: 'Штука', symbol: 'шт', isDefault: true })
  })

  it('больше потолка — ошибка, а не молча обрезанный справочник', async () => {
    await expect(readMeasures(async start => ({ measures: Array.from({ length: 50 }, (_, i) => unit(start + i + 1)) }), 50, 100))
      .rejects.toThrow('Единиц измерения в портале больше 100')
  })
})
