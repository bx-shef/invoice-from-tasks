import { describe, expect, it } from 'vitest'
import {
  columnDrift,
  grossPrice,
  lineAmounts,
  normalizeVatRate,
  parseMyCompanies,
  parseVatRates,
  vatForInvoice,
  vatLabel,
  vatTotals,
  type CompanyVat
} from '#shared/domain/vat'
import { roundMoney } from '#shared/domain/money'

describe('normalizeVatRate — ставка из хранилища или формы', () => {
  it('число от 0 до 100 до сотых; null — «Без НДС»', () => {
    expect(normalizeVatRate(20)).toBe(20)
    expect(normalizeVatRate('10')).toBe(10)
    expect(normalizeVatRate(0)).toBe(0)
    expect(normalizeVatRate(100)).toBe(100)
    expect(normalizeVatRate(16.667)).toBe(16.67)
    expect(normalizeVatRate(null)).toBeNull()
  })

  it('мусор — не ставка, а не молчаливые 0% или «Без НДС»', () => {
    for (const bad of [undefined, '', '  ', 'двадцать', -1, 100.01, Number.NaN, Number.POSITIVE_INFINITY, {}, [], true]) {
      expect(normalizeVatRate(bad)).toBeUndefined()
    }
  })
})

describe('vatLabel', () => {
  it('подписи для людей', () => {
    expect(vatLabel(null)).toBe('Без НДС')
    expect(vatLabel(20)).toBe('НДС 20%')
    expect(vatLabel(7.5)).toBe('НДС 7,5%')
    expect(vatLabel(0)).toBe('НДС 0%')
  })
})

describe('vatForInvoice — ставка по «Реквизитам вашей компании» счёта', () => {
  const companies: CompanyVat[] = [
    { companyId: 20, title: 'ООО Альфа', rate: 20 },
    { companyId: 22, title: '', rate: null }
  ]

  it('реквизиты есть в настройках — их ставка и название', () => {
    expect(vatForInvoice(companies, 20)).toEqual({ ok: true, rate: 20, company: 'ООО Альфа' })
  })

  it('«Без НДС» — тоже заданная ставка; без названия — #ID', () => {
    expect(vatForInvoice(companies, 22)).toEqual({ ok: true, rate: null, company: '#22' })
  })

  it('в счёте нет реквизитов — стоп, а не тихий «Без НДС»', () => {
    const res = vatForInvoice(companies, null)
    expect(res.ok).toBe(false)
    expect(!res.ok && res.problem).toBe('В счёте не выбраны «Реквизиты вашей компании» — выберите их в карточке счёта: по ним берётся ставка НДС')
  })

  it('реквизитов нет в настройках — стоп с подсказкой, где задать', () => {
    const res = vatForInvoice(companies, 99)
    expect(!res.ok && res.problem).toBe('Для «Реквизитов вашей компании» #99 в настройках приложения не задан НДС — администратор задаёт его в «Настройки → НДС»')
    expect(vatForInvoice([], 20).ok).toBe(false)
  })
})

describe('roundMoney — копейки как у портала', () => {
  it('половина копейки — вверх, даже когда двоичная дробь чуть меньше', () => {
    // 135,795 × 100 = 13579,4999… в double: Math.round(x * 100) дал бы 135,79.
    expect(roundMoney(135.795)).toBe(135.8)
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(678.975)).toBe(678.98)
    expect(roundMoney(1954.806)).toBe(1954.81)
    expect(roundMoney(2.2217778)).toBe(2.22)
    expect(roundMoney(0)).toBe(0)
    // Поправка на двоичную дробь не превращает настоящее «меньше половины» в половину.
    expect(roundMoney(0.004999999999)).toBe(0)
    expect(roundMoney(0.0049999)).toBe(0)
  })
})

describe('grossPrice — поле price строки (цена С налогом)', () => {
  it('цена без НДС × (1 + ставка), без округления до копеек', () => {
    expect(grossPrice(170, 20)).toBe(204)
    // Замер 2026-09-26: портал хранит 120,036 и выделяет цену без НДС ровно 100,03.
    expect(grossPrice(100.03, 20)).toBe(120.036)
    expect(grossPrice(123.45, 10)).toBe(135.795)
    expect(grossPrice(0.01, 20)).toBe(0.012)
    // Ставка с сотыми (16,67%) — все шесть знаков: 100,03 × 1,1667 = 116,705001; с четырьмя было бы
    // 116,705, и портал выделил бы цену без НДС 100,0299… вместо 100,03.
    expect(grossPrice(100.03, 16.67)).toBe(116.705001)
  })

  it('«Без НДС» и 0% — цена как есть', () => {
    expect(grossPrice(170, null)).toBe(170)
    expect(grossPrice(170, 0)).toBe(170)
  })
})

describe('vatTotals — итоги как у портала', () => {
  it('повтор замера 2026-09-26: девять строк → сумма счёта 1918,17 и НДС 263,04, как в портале', () => {
    // Тестовый портал, счёт #56: те же строки записаны `set` и `add`, портал вернул
    // opportunity 1918.17 и taxValue 263.04. НДС портал округляет по строкам, итог — один раз.
    const lines = [
      { price: 170, quantity: 1.5, taxRate: 20 },
      { price: 123.45, quantity: 5.5, taxRate: 20 },
      { price: 100.03, quantity: 1, taxRate: 20 },
      { price: 170, quantity: 1, taxRate: null },
      { price: 170, quantity: 1, taxRate: 0 },
      { price: 170, quantity: 1, taxRate: 20 },
      { price: 0.01, quantity: 3, taxRate: 20 },
      { price: 33.33, quantity: 0.3333, taxRate: 20 },
      { price: 50, quantity: 2, taxRate: 20 }
    ]
    expect(vatTotals(lines)).toEqual({ net: 1655.13, vat: 263.04, total: 1918.17 })
  })

  it('columnDrift: столбец из строк (каждая до копеек) против итога портала — те же 9 строк', () => {
    // «Сумма без налога» по строкам: 255 + 678,98 + 100,03 + 170 × 3 + 0,03 + 11,11 + 100 = 1655,15,
    // у портала — 1655,13: две копейки разницы.
    const nets = [255, 678.98, 100.03, 170, 170, 170, 0.03, 11.11, 100]
    expect(columnDrift(nets, 1655.13)).toBe(0.02)
    expect(columnDrift([140], 140)).toBe(0)
    // Расхождение вниз — отрицательное: предпросмотр показывает модуль.
    expect(columnDrift([0.01, 0.01], 0.03)).toBe(-0.01)
  })

  it('граница половины копейки — как у портала (замер 2026-09-26, по одной строке в счёте #56)', () => {
    // [цена без НДС, часы, итог счёта, налог] — ответ портала на каждую строку при 20%.
    const measured: Array<[number, number, number, number]> = [
      [2.75, 1.5, 4.95, 0.83], [10.73, 2.5, 32.19, 5.37], [14.23, 2.5, 42.69, 7.12], [19.55, 1.5, 35.19, 5.87],
      [27.46, 1.25, 41.19, 6.87], [123.45, 5.5, 814.77, 135.8], [3.3, 0.5, 1.98, 0.33], [0.05, 0.1, 0.01, 0]
    ]
    for (const [price, quantity, total, vat] of measured) {
      expect(vatTotals([{ price, quantity, taxRate: 20 }])).toMatchObject({ total, vat })
    }
  })

  it('без НДС: налог 0, итог — одно округление суммы строк', () => {
    expect(vatTotals([{ price: 123.45, quantity: 5.5, taxRate: null }, { price: 0.005, quantity: 1, taxRate: null }]))
      .toEqual({ net: 678.98, vat: 0, total: 678.98 })
    expect(vatTotals([])).toEqual({ net: 0, vat: 0, total: 0 })
  })
})

describe('lineAmounts — столбцы строки «Сумма налога» и «Сумма», как в товарной части счёта', () => {
  it('замер 2026-09-28: каждая строка одна в счёте #56 — сумма счёта и налог портала', () => {
    // [цена без НДС, количество, ставка, сумма без налога, налог, сумма] — налог и сумма — ответ
    // портала (taxValue, opportunity); сумма без налога — подстрока расчёта предпросмотра.
    const measured: Array<[number, number, number | null, number, number, number]> = [
      [170, 1, 20, 170, 34, 204],
      [170, 5.5, 20, 935, 187, 1122],
      // Режим «сумма × 1» даёт те же суммы, что и «цена часа × часы».
      [935, 1, 20, 935, 187, 1122],
      // Граница половины копейки: налог 0,825 → 0,83, а 4,13 + 0,83 ≠ 4,95 — так же у портала.
      [2.75, 1.5, 20, 4.13, 0.83, 4.95],
      [123.45, 5.5, 20, 678.98, 135.8, 814.77],
      [170, 1.25, null, 212.5, 0, 212.5],
      [33.33, 0.3333, 20, 11.11, 2.22, 13.33],
      [10.19, 5.5, 20, 56.05, 11.21, 67.25]
    ]
    for (const [price, quantity, taxRate, net, vat, total] of measured) {
      expect(lineAmounts({ price, quantity, taxRate })).toEqual({ net, vat, total })
    }
  })

  it('налог и «Сумма» по строкам сходятся с итогом портала, без налога — на копейки нет', () => {
    // Те же восемь строк одним счётом: портал вернул 3560,80 и 558,06 (замер 2026-09-28).
    const lines = [
      { price: 170, quantity: 1, taxRate: 20 }, { price: 170, quantity: 5.5, taxRate: 20 },
      { price: 935, quantity: 1, taxRate: 20 }, { price: 2.75, quantity: 1.5, taxRate: 20 },
      { price: 123.45, quantity: 5.5, taxRate: 20 }, { price: 170, quantity: 1.25, taxRate: null },
      { price: 33.33, quantity: 0.3333, taxRate: 20 }, { price: 10.19, quantity: 5.5, taxRate: 20 }
    ]
    const totals = vatTotals(lines)
    expect(totals).toMatchObject({ total: 3560.8, vat: 558.06 })
    const amounts = lines.map(lineAmounts)
    expect(columnDrift(amounts.map(a => a.vat), totals.vat)).toBe(0)
    expect(columnDrift(amounts.map(a => a.total), totals.total)).toBe(0)
    // Без налога: по строкам 3002,77, у портала 3560,80 − 558,06 = 3002,74.
    expect(columnDrift(amounts.map(a => a.net), totals.net)).toBe(0.03)
  })

  it('столбец «Сумма» тоже может разойтись: итог — одно округление, строки — каждая своё', () => {
    // Три строки по 0,01 при 20%: в строке 0,012 → 0,01, в итоге 0,036 → 0,04.
    const lines = Array.from({ length: 3 }, () => ({ price: 0.01, quantity: 1, taxRate: 20 }))
    const totals = vatTotals(lines)
    expect(totals.total).toBe(0.04)
    expect(columnDrift(lines.map(l => lineAmounts(l).total), totals.total)).toBe(-0.01)
  })
})

describe('разбор ответов портала', () => {
  it('catalog.vat.list: только активные ставки; без числа — «Без НДС»', () => {
    expect(parseVatRates({ vats: [
      { id: 1, name: 'НДС 20%', rate: 20, active: 'Y' },
      { id: 2, name: 'НДС 10%', rate: '10', active: 'N' },
      { id: 3, name: 'Без НДС', rate: null, active: 'Y' },
      { id: 4, name: '', rate: 0, active: 'Y' },
      { id: 5, name: 'Битая', rate: 'x', active: 'Y' },
      null
    ] })).toEqual([
      { name: 'НДС 20%', rate: 20 },
      { name: 'Без НДС', rate: null },
      { name: 'НДС 0%', rate: 0 }
    ])
    expect(parseVatRates(undefined)).toEqual([])
    expect(parseVatRates({ vats: 'x' })).toEqual([])
  })

  it('crm.item.list моих компаний: id числом, название без пробелов, мусор отброшен', () => {
    expect(parseMyCompanies({ items: [{ id: '20', title: ' ООО Альфа ' }, { id: 0, title: 'x' }, { title: 'без id' }, null, { id: 22 }] }))
      .toEqual([{ id: 20, title: 'ООО Альфа' }, { id: 22, title: '' }])
    expect(parseMyCompanies(null)).toEqual([])
  })
})
