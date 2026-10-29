import { describe, expect, it } from 'vitest'
import { planSave, saveSummary } from '../app/utils/saveBar'

const base = { isAdmin: true, settingsDirty: false, settingsBlocked: '', ratesDirty: false, ratesBlocked: '' }

describe('planSave', () => {
  it('без изменений сохранять нечего', () => {
    expect(planSave(base)).toEqual({ changed: [], saveSettings: false, saveRates: false, blocked: [] })
  })
  it('ошибка в ставках не мешает сохранить настройки', () => {
    const p = planSave({ ...base, settingsDirty: true, ratesDirty: true, ratesBlocked: 'в ставках ошибки' })
    expect(p.changed).toEqual(['настройки', 'ставки'])
    expect(p.saveSettings).toBe(true)
    expect(p.saveRates).toBe(false)
    expect(p.blocked).toEqual(['ставки: в ставках ошибки'])
  })
  it('не влезающие настройки не мешают ставкам', () => {
    const p = planSave({ ...base, settingsDirty: true, settingsBlocked: 'не влезают', ratesDirty: true })
    expect(p.saveSettings).toBe(false)
    expect(p.saveRates).toBe(true)
  })
  it('не-админ настройки не сохраняет', () => {
    const p = planSave({ ...base, isAdmin: false, settingsDirty: true, ratesDirty: true })
    expect(p.changed).toEqual(['ставки'])
    expect(p.saveSettings).toBe(false)
  })
})

describe('saveSummary', () => {
  it('всё сохранено', () => {
    expect(saveSummary(['настройки', 'ставки'], [])).toEqual({ ok: true, title: 'Сохранено: настройки, ставки' })
  })
  it('частичный сбой называет и сохранённое', () => {
    const s = saveSummary(['настройки'], ['ставки: сеть'])
    expect(s.ok).toBe(false)
    expect(s.description).toBe('Сохранено: настройки. Ошибка — ставки: сеть')
  })
})
