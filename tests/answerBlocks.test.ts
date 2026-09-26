import { describe, expect, it } from 'vitest'
import { answerBlocks, answerSpans } from '~/utils/answerBlocks'

describe('answerBlocks — ответ BitrixGPT для окна приложения', () => {
  it('абзацы, маркированный и нумерованный списки, заголовок и **жирный**', () => {
    expect(answerBlocks('## Риски\nЧто может вызвать вопросы:\n\n- **Срок** оплаты\n* Нет договора\n\n1. Согласовать\n2) Добавить номер')).toEqual([
      { kind: 'p', lines: [[{ text: 'Риски', bold: true }], [{ text: 'Что может вызвать вопросы:', bold: false }]] },
      { kind: 'ul', items: [[{ text: 'Срок', bold: true }, { text: ' оплаты', bold: false }], [{ text: 'Нет договора', bold: false }]] },
      { kind: 'ol', items: [[{ text: 'Согласовать', bold: false }], [{ text: 'Добавить номер', bold: false }]] }
    ])
  })

  it('пустая строка разделяет абзацы; текст после списка — новый абзац', () => {
    expect(answerBlocks('a\nb\n\nc\n- x\nd').map(b => b.kind)).toEqual(['p', 'p', 'ul', 'p'])
    expect(answerBlocks('a\nb')[0]).toEqual({ kind: 'p', lines: [[{ text: 'a', bold: false }], [{ text: 'b', bold: false }]] })
  })

  it('разметка — только текст: HTML и BB остаются строкой (Vue их экранирует)', () => {
    expect(answerSpans('<b>x</b> [URL=a]b[/URL]')).toEqual([{ text: '<b>x</b> [URL=a]b[/URL]', bold: false }])
    expect(answerSpans('**** и ** **')).toEqual([{ text: '**** и ** **', bold: false }])
  })

  it('пусто и мусор — нет блоков', () => {
    expect(answerBlocks('')).toEqual([])
    expect(answerBlocks('\n\n  \n')).toEqual([])
    expect(answerBlocks(undefined as unknown as string)).toEqual([])
  })
})
