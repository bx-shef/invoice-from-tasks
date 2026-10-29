import { describe, expect, it } from 'vitest'
import { SETTINGS_GROUPS, effectiveSection, settingsGroupsFor } from '../app/utils/settingsNav'

describe('settingsNav', () => {
  it('админ видит 9 разделов в 4 группах', () => {
    const g = settingsGroupsFor(true)
    expect(g.map(x => x.title)).toEqual(['Расчёт', 'Клиент', 'ИИ', 'Система'])
    expect(g.flatMap(x => x.items).length).toBe(9)
  })
  it('не-админ видит только «Ставки»', () => {
    const g = settingsGroupsFor(false)
    expect(g).toEqual([{ title: 'Расчёт', items: [{ value: 'rates', label: 'Ставки' }] }])
    expect(SETTINGS_GROUPS.flatMap(x => x.items).length).toBe(9)
  })
  it('раздел не-админа — всегда «Ставки»', () => {
    expect(effectiveSection('vat', false)).toBe('rates')
    expect(effectiveSection('vat', true)).toBe('vat')
  })
})
