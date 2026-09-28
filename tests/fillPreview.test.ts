import { describe, expect, it } from 'vitest'
import type { DraftRow } from '#shared/domain/fill'
import { vatTotals } from '#shared/domain/vat'
import {
  driftNote,
  formatMoney,
  hoursText,
  issueText,
  openTaskText,
  placementNote,
  previewLine,
  rateBasis,
  vatCaption,
  type PreviewContext
} from '~/utils/fillPreview'

// Портал и Node пишут тысячи через неразрывный пробел: «1 122,00».
const nb = (text: string) => text.replace(/ /g, ' ')

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

const ctx: PreviewContext = { currency: 'BYN', rateCurrency: 'BYN', userLabel: id => (id === 1 ? 'Игорь Шевчик' : `#${id}`) }

describe('previewLine — столбцы как в товарной части счёта', () => {
  it('t2 из счёта t12: цена, количество, налог, включён, сумма налога, сумма — как у портала', () => {
    const line = previewLine(row, ctx)
    expect([line.price, line.quantity, line.tax, line.included, line.vat, line.total])
      .toEqual(['170,00', '5,5', '20%', 'нет', '187,00', nb('1 122,00')])
    expect(line.totalValue).toBe(1122)
  })

  it('режим «сумма × 1»: цена — сумма строки, количество 1; суммы те же', () => {
    const line = previewLine({ ...row, price: 935, quantity: 1 }, ctx)
    expect([line.price, line.quantity, line.vat, line.total]).toEqual(['935,00', '1', '187,00', nb('1 122,00')])
  })

  it('граница копейки: налог и сумма строки — округлены каждая отдельно (2,75 × 1,5 → 0,83 и 4,95)', () => {
    const line = previewLine({ ...row, price: 2.75, quantity: 1.5 }, ctx)
    expect([line.vat, line.total]).toEqual(['0,83', '4,95'])
  })

  it('«Без НДС»: налог «Без НДС», «Включён» — прочерк, сумма = цена × количество', () => {
    const line = previewLine({ ...row, taxRate: null }, ctx)
    expect([line.tax, line.included, line.vat, line.total]).toEqual(['Без НДС', '—', '0,00', '935,00'])
  })

  it('НДС 0% — это ставка, а не «Без НДС»', () => {
    expect(previewLine({ ...row, taxRate: 0 }, ctx)).toMatchObject({ tax: '0%', included: 'нет', total: '935,00' })
  })

  it('подстроки: кто, часы × цена часа = сумма без налога; откуда цена часа; дата ставки', () => {
    const line = previewLine(row, ctx)
    expect(line.calc).toBe('Игорь Шевчик · 5,5 ч (списано 5 ч 01 мин) × 170,00 = 935,00')
    expect(line.basis).toBe('ставка 170,00 + наценка 0% (на всё)')
    expect(line.rateTitle).toBe('Ставка на 28.09.2026')
  })
})

describe('подстроки расчёта', () => {
  it('часы: округление ничего не поменяло — без «списано»', () => {
    expect(hoursText({ ...row, seconds: 3600, roundedSeconds: 3600, hours: 1 })).toBe('1 ч')
    expect(hoursText(row)).toBe('5,5 ч (списано 5 ч 01 мин)')
  })

  it('наценка по тегу — с тегом; валюта ставок другая — «по курсу», иначе цена часа выглядит ошибкой', () => {
    const tagged: DraftRow = { ...row, baseRate: 100, markupPercent: 70, markupSource: 'tag', markupTag: 'дизайн', hourPrice: 2.02 }
    expect(rateBasis(tagged, { ...ctx, currency: 'USD', rateCurrency: 'RUB' })).toBe('ставка 100,00 RUB по курсу + наценка 70% (#дизайн)')
    expect(rateBasis(tagged, ctx)).toBe('ставка 100,00 + наценка 70% (#дизайн)')
  })
})

describe('подписи таблицы', () => {
  it('как строка ляжет в счёт — по режиму; «Без НДС» — без слов про налог сверху', () => {
    expect(placementNote('hour', 20)).toBe('Цена — без НДС, налог сверху (в цену не включён); в счёт: цена — цена часа, количество — часы')
    expect(placementNote('sum', 20)).toBe('Цена — без НДС, налог сверху (в цену не включён); в счёт: цена — сумма строки, количество — 1')
    expect(placementNote('hour', null)).toBe('Без НДС — налога в строках нет; в счёт: цена — цена часа, количество — часы')
    expect(placementNote('hour', 0)).toContain('налог сверху')
  })

  it('подпись налога: ставка и реквизиты; без НДС счёта — просто «Сумма налога:»', () => {
    expect(vatCaption({ rate: 20, company: 'ООО Альфа' })).toBe('Сумма налога (НДС 20% — реквизиты «ООО Альфа»):')
    expect(vatCaption({ rate: null, company: 'ИП Бета' })).toBe('Сумма налога (Без НДС — реквизиты «ИП Бета»):')
    expect(vatCaption(null)).toBe('Сумма налога:')
  })

  it('деньги — как в карточке счёта', () => {
    expect(formatMoney(1326)).toBe(nb('1 326,00'))
    expect(formatMoney(0.83)).toBe('0,83')
  })
})

describe('driftNote — пояснение, когда столбец «Сумма» расходится с «Общей суммой»', () => {
  it('сходится — пояснения нет (t12: 204 + 1122 = 1326)', () => {
    const rows = [{ ...row, price: 170, quantity: 1 }, row]
    const lines = rows.map(r => previewLine(r, ctx))
    expect(driftNote(lines, vatTotals(rows))).toBeNull()
  })

  it('три строки по 0,01 при 20%: в строках 0,01 × 3, итог 0,04 — пояснение с размером расхождения', () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ ...row, key: `t${i}`, price: 0.01, quantity: 1 }))
    const note = driftNote(rows.map(r => previewLine(r, ctx)), vatTotals(rows))
    expect(note).toBe('Каждая строка округлена до копеек, а «Общую сумму» портал округляет один раз — поэтому '
      + 'столбец «Сумма» расходится с ней на 0,01. В счёте будет «Общая сумма» как здесь.')
  })

  it('суммы без налога (подстроки) с итогом не сверяются: о столбце, которого нет, не говорим', () => {
    // Те же 8 строк, что в замере 2026-09-28: без налога по строкам 3002,77, у портала 3002,74 — а
    // «Сумма» сходится, поэтому пояснения нет.
    const measured: Array<[number, number, number | null]> = [[170, 1, 20], [170, 5.5, 20], [935, 1, 20], [2.75, 1.5, 20], [123.45, 5.5, 20], [170, 1.25, null], [33.33, 0.3333, 20], [10.19, 5.5, 20]]
    const rows = measured.map(([price, quantity, taxRate], i) => ({ ...row, key: `t${i}`, price, quantity, taxRate }))
    expect(driftNote(rows.map(r => previewLine(r, ctx)), vatTotals(rows))).toBeNull()
  })
})

describe('тексты проблем и незакрытых задач', () => {
  it('после ссылки «Задача #N» — двоеточие без пробела перед ним; без задачи — только текст', () => {
    expect(issueText({ taskId: 102, message: 'в задаче нет затраченного времени' })).toBe(': в задаче нет затраченного времени')
    expect(issueText({ taskId: 0, message: 'не найдено ни одной задачи' })).toBe('не найдено ни одной задачи')
  })

  it('незакрытые задачи — через запятую, у последней запятой нет', () => {
    expect(openTaskText({ taskId: 102, status: 'ждёт выполнения' }, false)).toBe(' — ждёт выполнения,')
    expect(openTaskText({ taskId: 104, status: 'выполняется' }, true)).toBe(' — выполняется')
  })
})
