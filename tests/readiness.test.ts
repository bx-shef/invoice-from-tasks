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
})
