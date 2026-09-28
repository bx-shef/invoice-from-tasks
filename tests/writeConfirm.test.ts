import { describe, expect, it } from 'vitest'
import { rowsWord, writeConfirmations } from '~/utils/writeConfirm'

describe('rowsWord — «строку / строки / строк»', () => {
  it('по правилам русского числа', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(n => `${n} ${rowsWord(n)}`)).toEqual([
      '1 строку', '2 строки', '4 строки', '5 строк', '11 строк', '12 строк', '14 строк', '21 строку', '22 строки', '25 строк', '101 строку', '111 строк'
    ])
  })
})

describe('writeConfirmations — что спросить перед записью', () => {
  it('«Добавить» спрашивает дважды: что и куда, потом «точно?» с объяснением дублей', () => {
    const questions = writeConfirmations('append', 3, 2)
    expect(questions).toEqual([
      'Добавить 2 строки к 3 поз. счёта? Строки встанут после существующих.',
      'Точно добавить? Если эти строки уже добавляли, в счёте будут дубли — отменить добавление нельзя, '
      + 'лишние позиции придётся удалять в карточке счёта.'
    ])
  })

  it('«Добавить» в пустой счёт — тоже дважды', () => {
    const questions = writeConfirmations('append', 0, 1)
    expect(questions).toHaveLength(2)
    expect(questions[0]).toBe('Добавить 1 строку в счёт?')
  })

  it('«Заменить» — один вопрос, если позиции уже есть; пустой счёт — без вопросов', () => {
    expect(writeConfirmations('replace', 4, 2)).toEqual(['В счёте уже 4 поз. Заменить их строками из задач?'])
    expect(writeConfirmations('replace', 0, 2)).toEqual([])
  })
})
