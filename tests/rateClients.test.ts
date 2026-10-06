import { describe, expect, it } from 'vitest'
import { clientLabel, clientNamesCalls, parseClientNames, pickedClient } from '~/utils/rateClients'

describe('клиенты ставок', () => {
  it('запросы названий — по типу, без дублей и мусора', () => {
    const calls = clientNamesCalls(['CO_1', 'C_2', 'CO_1', 'X_3'])
    expect(calls).toEqual([
      { method: 'crm.item.list', params: { entityTypeId: 4, filter: { '@id': [1] }, select: ['id', 'title'] } },
      { method: 'crm.item.list', params: { entityTypeId: 3, filter: { '@id': [2] }, select: ['id', 'name', 'lastName'] } }
    ])
    expect(clientNamesCalls(Array.from({ length: 51 }, (_, i) => `CO_${i + 1}`))).toHaveLength(2)
  })

  it('разбор названий компании и контакта', () => {
    const [co, c] = clientNamesCalls(['CO_1', 'C_2'])
    expect(parseClientNames(co!, { items: [{ id: 1, title: 'ООО Ромашка' }, null] })).toEqual({ CO_1: 'ООО Ромашка' })
    expect(parseClientNames(c!, { items: [{ id: 2, name: 'Иван', lastName: 'Петров' }] })).toEqual({ C_2: 'Иван Петров' })
    expect(parseClientNames(c!, null)).toEqual({})
  })

  it('выбор в диалоге и подпись без названия', () => {
    expect(pickedClient({ company: [{ id: 'CO_7', type: 'company', place: '', title: 'А', desc: '', url: '', image: '' }] })).toEqual({ code: 'CO_7', title: 'А' })
    expect(pickedClient({})).toBeNull()
    expect(clientLabel('C_9', {})).toBe('Контакт #9')
    expect(clientLabel('CO_9', { CO_9: 'Б' })).toBe('Б')
  })
})
