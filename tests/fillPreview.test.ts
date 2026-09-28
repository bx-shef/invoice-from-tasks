import { describe, expect, it } from 'vitest'
import type { DraftRow } from '#shared/domain/fill'
import { vatTotals } from '#shared/domain/vat'
import {
  alignClass,
  driftNote,
  formatMoney,
  formatNumber,
  hoursText,
  issueText,
  OPEN_TASKS_TITLE,
  openTaskText,
  outlierTaskIds,
  outlierText,
  OUTLIERS_TITLE,
  placementNote,
  PREVIEW_COLUMNS,
  previewContext,
  previewLine,
  previewTotals,
  rateBasis,
  taskHref,
  unitNoticeShown,
  vatCaption,
  type PreviewContext
} from '~/utils/fillPreview'

// Карточка счёта пишет тысячи через неразрывный пробел: «1 122,00».
const nb = (text: string) => text.replace(/ /g, '\u00A0')

/** Строка t2 счёта t12 (живая проверка владельца 2026-09-28): 5 ч 01 мин → 5,5 ч по 170 при 20%. */
const row: DraftRow = {
  key: 't104',
  taskId: 104,
  userId: 1,
  name: 't2',
  seconds: 18_060,
  roundedSeconds: 19_800,
  hours: 5.5,
  baseRate: 170,
  rateDate: '2026-09-28',
  markupPercent: 0,
  markupSource: 'default',
  hourPrice: 170,
  price: 170,
  quantity: 5.5,
  sum: 935,
  taxRate: 20
}

const ctx: PreviewContext = { convertedFrom: null, userLabel: id => (id === 1 ? 'Игорь Шевчик' : `#${id}`) }

describe('столбцы — как в товарной части счёта', () => {
  it('порядок и выравнивание столбцов справа от названия строки', () => {
    expect(PREVIEW_COLUMNS.map(c => c.title)).toEqual(['Цена', 'Количество', 'Налог', 'Включён', 'Сумма налога', 'Сумма'])
    expect(PREVIEW_COLUMNS.map(c => c.align)).toEqual(['right', 'right', 'right', 'center', 'right', 'right'])
  })

  it('t2 из счёта t12: ячейки по порядку столбцов — цифры как у портала', () => {
    const line = previewLine(row, 'ч', ctx)
    expect(line.cells).toEqual(['170,00', nb('5,5 ч'), '20%', 'нет', '187,00', nb('1 122,00')])
    expect(line.cells).toHaveLength(PREVIEW_COLUMNS.length)
  })

  it('в каждой строке — ровно по ячейке на столбец, выравнивание — из столбца', () => {
    for (const r of [row, { ...row, taxRate: null }, { ...row, taxRate: 0 }, { ...row, price: 2.75, quantity: 1.5 }]) {
      expect(previewLine(r, 'ч', ctx).cells).toHaveLength(PREVIEW_COLUMNS.length)
    }
    expect(PREVIEW_COLUMNS.map(alignClass)).toEqual(['text-right', 'text-right', 'text-right', 'text-center', 'text-right', 'text-right'])
    expect(alignClass(undefined)).toBe('text-right')
  })

  it('единица не задана — количество без неё', () => {
    expect(previewLine(row, '', ctx).cells[1]).toBe('5,5')
  })

  it('режим «сумма × 1»: цена — сумма строки, количество 1; суммы те же', () => {
    expect(previewLine({ ...row, price: 935, quantity: 1 }, 'шт', ctx).cells)
      .toEqual(['935,00', nb('1 шт'), '20%', 'нет', '187,00', nb('1 122,00')])
  })

  it('граница копейки: налог и сумма строки — округлены каждая отдельно (2,75 × 1,5 → 0,83 и 4,95)', () => {
    expect(previewLine({ ...row, price: 2.75, quantity: 1.5 }, '', ctx).cells.slice(4)).toEqual(['0,83', '4,95'])
  })

  it('«Без НДС»: налог «Без НДС», «Включён» — прочерк, сумма = цена × количество', () => {
    expect(previewLine({ ...row, taxRate: null }, '', ctx).cells.slice(2)).toEqual(['Без НДС', '—', '0,00', '935,00'])
  })

  it('НДС 0% — это ставка, а не «Без НДС»', () => {
    expect(previewLine({ ...row, taxRate: 0 }, '', ctx).cells.slice(2)).toEqual(['0%', 'нет', '0,00', '935,00'])
  })

  it('подстроки: кто, часы × цена часа = сумма без налога; откуда цена часа; дата ставки', () => {
    const line = previewLine(row, 'ч', ctx)
    expect(line.calc).toBe('Игорь Шевчик · 5,5 ч (списано 5 ч 01 мин) × 170,00 = 935,00')
    expect(line.basis).toBe('ставка 170,00 + наценка 0% (на всё)')
    expect(line.rateTitle).toBe('Ставка на 28.09.2026')
  })
})

describe('итоги под таблицей', () => {
  it('без налога, налог с реквизитами, общая сумма с валютой — в этом порядке', () => {
    expect(previewTotals({ net: 1105, vat: 221, total: 1326 }, { rate: 20, company: 'ООО Альфа' }, 'BYN')).toEqual([
      { label: 'Сумма без налога:', value: nb('1 105,00'), testId: 'fill-net', strong: false },
      { label: 'Сумма налога (НДС 20% — реквизиты «ООО Альфа»):', value: '221,00', testId: 'fill-vat', strong: false },
      { label: 'Общая сумма:', value: `${nb('1 326,00')} BYN`, testId: 'fill-total', strong: true }
    ])
  })

  it('валюты у счёта нет — сумма без хвостового пробела', () => {
    expect(previewTotals({ net: 1, vat: 0, total: 1 }, null, '')[2]!.value).toBe('1,00')
  })

  it('подпись налога: ставка и реквизиты; без НДС счёта — просто «Сумма налога:»', () => {
    expect(vatCaption({ rate: null, company: 'ИП Бета' })).toBe('Сумма налога (Без НДС — реквизиты «ИП Бета»):')
    expect(vatCaption(null)).toBe('Сумма налога:')
  })
})

describe('числа — без toLocaleString, одинаково в любой среде', () => {
  it('деньги: разряды через неразрывный пробел, копейки через запятую', () => {
    expect(formatMoney(1326)).toBe(nb('1 326,00'))
    expect(formatMoney(1_234_567.8)).toBe(nb('1 234 567,80'))
    expect(formatMoney(0.83)).toBe('0,83')
    expect(formatMoney(135.795)).toBe('135,80')
  })

  it('−0 и копеечный минус — «0,00», а не «-0,00»; настоящий минус остаётся', () => {
    expect(formatMoney(-0)).toBe('0,00')
    expect(formatMoney(-0.001)).toBe('0,00')
    expect(formatMoney(-12.5)).toBe('-12,50')
  })

  it('не число или неправдоподобно большое — прочерк, а не «NaN,undefined» или «1e+21»', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e21, 1e15]) {
      expect(formatMoney(bad), String(bad)).toBe('—')
      expect(formatNumber(bad), String(bad)).toBe('—')
    }
    expect(formatMoney(999_999_999_999.99)).toBe(nb('999 999 999 999,99'))
  })

  it('знак у количества: минус остаётся, округлённый до нуля — нет', () => {
    expect(formatNumber(-5.5)).toBe('-5,5')
    expect(formatNumber(-0.00001)).toBe('0')
  })

  it('количество и проценты: до четырёх знаков, без хвостовых нулей', () => {
    expect(formatNumber(5.5)).toBe('5,5')
    expect(formatNumber(1)).toBe('1')
    expect(formatNumber(0.3333)).toBe('0,3333')
    expect(formatNumber(0.33333)).toBe('0,3333')
    expect(formatNumber(12_500)).toBe(nb('12 500'))
    expect(formatNumber(-0)).toBe('0')
  })
})

describe('подстроки расчёта', () => {
  it('часы: округление ничего не поменяло — без «списано»', () => {
    expect(hoursText({ ...row, seconds: 3600, roundedSeconds: 3600, hours: 1 })).toBe('1 ч')
    expect(hoursText(row)).toBe('5,5 ч (списано 5 ч 01 мин)')
  })

  it('«по курсу» — по самому пересчёту: валюта ставок из него, нет пересчёта — нет подписи', () => {
    const label = (id: number) => `#${id}`
    expect(previewContext({ from: 'RUB', to: 'USD', factor: 0.0123, notice: '' }, label).convertedFrom).toBe('RUB')
    expect(previewContext(null, label).convertedFrom).toBeNull()
    expect(previewContext(null, label).userLabel).toBe(label)
  })

  it('наценка по тегу — с тегом, дробная — с запятой; цены пересчитаны — «по курсу»', () => {
    const tagged: DraftRow = { ...row, baseRate: 100, markupPercent: 12.5, markupSource: 'tag', markupTag: 'дизайн', hourPrice: 1.36 }
    expect(rateBasis(tagged, { ...ctx, convertedFrom: 'RUB' })).toBe('ставка 100,00 RUB по курсу + наценка 12,5% (#дизайн)')
    expect(rateBasis(tagged, ctx)).toBe('ставка 100,00 + наценка 12,5% (#дизайн)')
  })
})

describe('placementNote — как строка ляжет в счёт', () => {
  it('по режиму; «Без НДС» — без слов про налог сверху; 0% — ставка', () => {
    expect(placementNote('hour', 20)).toBe('Цена — без НДС, налог сверху (в цену не включён); в счёт: цена — цена часа, количество — часы')
    expect(placementNote('sum', 20)).toBe('Цена — без НДС, налог сверху (в цену не включён); в счёт: цена — сумма строки, количество — 1')
    expect(placementNote('hour', null)).toBe('Без НДС — налога в строках нет; в счёт: цена — цена часа, количество — часы')
    expect(placementNote('hour', 0)).toContain('налог сверху')
  })
})

describe('driftNote — когда видимые числа строк не складываются в итоги', () => {
  const withRows = (specs: Array<[number, number, number | null]>) =>
    specs.map(([price, quantity, taxRate], i) => ({ ...row, key: `t${i}`, price, quantity, taxRate, sum: Math.round(price * quantity * 100) / 100 }))

  it('всё сходится — пояснения нет (t12: 204 + 1122 = 1326, 170 + 935 = 1105)', () => {
    const rows = withRows([[170, 1, 20], [170, 5.5, 20]])
    expect(driftNote(rows, vatTotals(rows))).toBeNull()
  })

  it('столбец «Сумма»: три строки по 0,01 при 20% — в строках 0,01 × 3, итог 0,04', () => {
    // Налог строк 0,002 → 0: «без налога» внизу и есть «Общая сумма» — второе пояснение лишнее.
    const rows = withRows([[0.01, 1, 20], [0.01, 1, 20], [0.01, 1, 20]])
    expect(driftNote(rows, vatTotals(rows))).toBe('Каждая строка округлена до копеек, а «Общую сумму» портал округляет '
      + 'один раз — поэтому столбец «Сумма» расходится с ней на 0,01. В счёте будут итоги как здесь.')
  })

  it('без налога («Без НДС» и 0%) — только про столбец «Сумма»: причина одна, налог не округлялся', () => {
    for (const rate of [null, 0]) {
      const rows = withRows([[1.01, 0.5, rate], [1.01, 0.5, rate]])
      expect(driftNote(rows, vatTotals(rows)), String(rate)).toBe('Каждая строка округлена до копеек, а «Общую сумму» '
        + 'портал округляет один раз — поэтому столбец «Сумма» расходится с ней на 0,01. В счёте будут итоги как здесь.')
    }
  })

  it('подстроки: одна строка 2,75 × 1,5 при 20% — «= 4,13», а «Сумма без налога» 4,95 − 0,83 = 4,12', () => {
    const rows = withRows([[2.75, 1.5, 20]])
    expect(vatTotals(rows).net).toBe(4.12)
    expect(driftNote(rows, vatTotals(rows))).toBe('«Сумма без налога» — это «Общая сумма» минус «Сумма налога», а налог '
      + 'округлён по строкам — поэтому суммы в подстроках расчёта расходятся с ней на 0,01. В счёте будут итоги как здесь.')
  })
})

describe('незакрытые задачи, проблемы, ссылки', () => {
  it('заголовок блока не обещает запись: блок виден и когда записать нельзя', () => {
    expect(OPEN_TASKS_TITLE).toBe('Не все задачи закрыты — время в них ещё может добавиться')
  })

  it('предупреждение о единице — только когда есть строки', () => {
    expect(unitNoticeShown('кода нет в справочнике', 2)).toBe('кода нет в справочнике')
    expect(unitNoticeShown('кода нет в справочнике', 0)).toBeNull()
    expect(unitNoticeShown(null, 2)).toBeNull()
  })

  it('незакрытые задачи — через запятую, у последней запятой нет', () => {
    expect(openTaskText({ taskId: 102, status: 'ждёт выполнения' }, false)).toBe(' — ждёт выполнения,')
    expect(openTaskText({ taskId: 104, status: 'выполняется' }, true)).toBe(' — выполняется')
  })

  it('после ссылки «Задача #N» — двоеточие без пробела перед ним; без задачи — только текст', () => {
    expect(issueText({ taskId: 102, message: 'в задаче нет затраченного времени' })).toBe(': в задаче нет затраченного времени')
    expect(issueText({ taskId: 0, message: 'не найдено ни одной задачи' })).toBe('не найдено ни одной задачи')
  })

  it('ссылка на задачу — адрес портала и путь задачи', () => {
    expect(taskHref('https://portal.bitrix24.by', 104)).toBe('https://portal.bitrix24.by/company/personal/user/0/tasks/task/view/104/')
  })
})

describe('задачи со временем заметно больше обычного — тексты блока', () => {
  it('заголовок просит проверить; «5,5 ч при обычных 1 ч», у последней без запятой', () => {
    expect(OUTLIERS_TITLE).toBe('Время по задаче заметно больше обычного — проверьте')
    expect(outlierText({ taskId: 104, seconds: 19_800, typicalSeconds: 3600 }, false)).toBe(' — 5,5 ч при обычных 1 ч,')
    expect(outlierText({ taskId: 104, seconds: 19_800, typicalSeconds: 5400 }, true)).toBe(' — 5,5 ч при обычных 1,5 ч')
  })

  it('подсветка — строки этих задач', () => {
    const ids = outlierTaskIds([{ taskId: 104, seconds: 1, typicalSeconds: 1 }])
    expect(ids.has(104)).toBe(true)
    expect(ids.has(102)).toBe(false)
  })
})
