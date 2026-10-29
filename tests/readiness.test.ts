import { describe, expect, it } from 'vitest'
import { parseSettings } from '../shared/domain/settings'
import { readiness } from '../app/utils/readiness'

const base = parseSettings({})

describe('readiness', () => {
  it('пустые настройки: обязательные пункты не готовы, ведут в нужный раздел', () => {
    const r = readiness(base, [])
    const rates = r.find(i => i.key === 'rates')!
    expect(rates.ok).toBe(false)
    expect(rates.section).toBe('general')
    expect(r.find(i => i.key === 'vat')).toMatchObject({ ok: false, required: true, section: 'vat' })
  })
  it('ставки считаются по людям, клиентские — отдельно', () => {
    const s = { ...base, currency: 'BYN' }
    const r = readiness(s, [{ userId: 1 }, { userId: 1, client: 'CO_1' }, { userId: 2 }])
    expect(r[0]).toMatchObject({ ok: true, section: 'rates', text: 'Ставки: 2 сотрудника, клиентских 1 · BYN' })
  })
  it('валюта есть, ставок нет', () => {
    expect(readiness({ ...base, currency: 'BYN' }, [])[0]).toMatchObject({ ok: false, section: 'rates' })
  })
  it('публичная страница и доступ', () => {
    const s = { ...base, rateEditors: [5], publicPage: { ...base.publicPage, stages: ['A', 'B'], approvalStage: 'B' } }
    const r = readiness(s, [])
    expect(r.find(i => i.key === 'publicPage')).toMatchObject({ ok: true, text: 'Публичная страница: 2 стадии, есть согласование' })
    expect(r.find(i => i.key === 'access')!.text).toBe('Ставки меняют ещё 1 сотрудник кроме админов')
  })
  it('НДС задан и поле клиента выбрано', () => {
    const s = { ...base, vat: [{ companyId: 1, rate: 20 }] as typeof base.vat, clientFields: { task: 'UF_X', taskDomain: '' } }
    const r = readiness(s, [])
    expect(r.find(i => i.key === 'vat')).toMatchObject({ ok: true, text: 'НДС задан (реквизитов вашей компании: 1)' })
    expect(r.find(i => i.key === 'clientFields')).toMatchObject({ ok: true, required: false })
  })
  it.each([[5, '5 сотрудников'], [11, '11 сотрудников'], [21, '21 сотрудник'], [3, '3 сотрудника']])('склонение: %i', (n, w) => {
    const r = readiness({ ...base, currency: 'BYN' }, Array.from({ length: n }, (_, i) => ({ userId: i + 1 })))
    expect(r[0]!.text).toBe(`Ставки: ${w} · BYN`)
  })
})
