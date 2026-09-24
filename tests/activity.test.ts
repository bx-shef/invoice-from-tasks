import { describe, expect, it } from 'vitest'
import { buildConsultActivity, MAX_ACTIVITY_TEXT, neutralizeMarkup } from '#shared/domain/activity'
import { parseExistingRows } from '#shared/domain/invoice'
import { tokenNeedsRefresh } from '~/utils/frameToken'

describe('дело с ответом консультации', () => {
  it('параметры crm.activity.todo.add: владелец — счёт, срок — сейчас', () => {
    const p = buildConsultActivity({ invoiceId: 8, promptTitle: 'Риски', answer: 'Всё хорошо', responsibleId: 5, nowMs: Date.UTC(2026, 0, 1) })
    expect(p).toEqual({
      ownerTypeId: 31,
      ownerId: 8,
      deadline: '2026-01-01T00:00:00.000Z',
      title: 'Консультация BitrixGPT: Риски',
      description: 'Всё хорошо',
      responsibleId: 5
    })
  })

  it('разметка из ответа модели не станет ни ссылкой, ни тегом в карточке', () => {
    expect(neutralizeMarkup('[URL=https://evil]жми[/URL]')).toBe('［URL=https://evil］жми［/URL］')
    expect(neutralizeMarkup('<img src=x onerror=alert(1)>')).toBe('＜img src=x onerror=alert(1)＞')
    const p = buildConsultActivity({ invoiceId: 1, promptTitle: '[B]x[/B]', answer: '[URL=a]b[/URL]', responsibleId: 0, nowMs: 0 })
    expect(String(p.description)).not.toMatch(/[[\]<>]/)
    expect(String(p.title)).not.toMatch(/[[\]<>]/)
    expect(p).not.toHaveProperty('responsibleId')
  })

  it('длинный ответ обрезается', () => {
    const p = buildConsultActivity({ invoiceId: 1, promptTitle: 't', answer: 'x'.repeat(MAX_ACTIVITY_TEXT + 10), responsibleId: 0, nowMs: 0 })
    expect(String(p.description)).toHaveLength(MAX_ACTIVITY_TEXT)
  })
})

describe('существующие позиции счёта', () => {
  it('разбирает productRows и отбрасывает строки без id', () => {
    expect(parseExistingRows([{ id: 3, productName: 'Часы', price: '100', quantity: 2, sort: 20 }, { productName: 'без id' }]))
      .toEqual([{ id: 3, productName: 'Часы', price: 100, quantity: 2, sort: 20 }])
    expect(parseExistingRows(null)).toEqual([])
  })
})

describe('свежесть фрейм-токена перед запросом к серверу', () => {
  it('обновляем, если токена нет или жить ему меньше минуты', () => {
    const now = 1_000_000
    expect(tokenNeedsRefresh(false, now)).toBe(true)
    expect(tokenNeedsRefresh({ expires: (now + 30_000) / 1000 }, now)).toBe(true)
    expect(tokenNeedsRefresh({ expires: (now + 3_600_000) / 1000 }, now)).toBe(false)
  })
})
