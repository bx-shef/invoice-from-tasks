import { describe, expect, it } from 'vitest'
import { answerYes, duplicateCount, positionsChanged, rowsWord, startConfirm, writeConfirmations } from '~/utils/writeConfirm'

const NO_UNDO = 'Отменить добавление нельзя — лишние позиции придётся удалять в карточке счёта.'

describe('rowsWord — «строку / строки / строк»', () => {
  it('по правилам русского числа', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(n => `${n} ${rowsWord(n)}`)).toEqual([
      '1 строку', '2 строки', '4 строки', '5 строк', '11 строк', '12 строк', '14 строк', '21 строку', '22 строки', '25 строк', '101 строку', '111 строк'
    ])
  })
})

describe('duplicateCount — строки, которые уже есть в счёте под тем же названием', () => {
  it('без учёта регистра и пробелов по краям; каждая добавляемая строка считается один раз', () => {
    expect(duplicateCount(['[102] Вёрстка', 'Дизайн '], ['[102] вёрстка', ' дизайн', 'Сервер'])).toBe(2)
    expect(duplicateCount([], ['Вёрстка'])).toBe(0)
    expect(duplicateCount(['Вёрстка'], ['Вёрстка шапки'])).toBe(0)
  })
})

describe('writeConfirmations — что спросить перед записью', () => {
  it('«Добавить» спрашивает дважды: что и куда, потом «точно?» — чем грозит повтор', () => {
    expect(writeConfirmations('append', ['a', 'b', 'c'], ['x', 'y'])).toEqual([
      { text: 'Добавить 2 строки к 3 поз. счёта? Строки встанут после существующих.', confirm: 'Да, добавить' },
      { text: `Точно добавить? Если эти задачи уже добавляли в счёт, позиции задвоятся. ${NO_UNDO}`, confirm: 'Точно добавить' }
    ])
  })

  it('те же названия уже в счёте — второй вопрос называет, сколько задвоится', () => {
    const [, second] = writeConfirmations('append', ['[102] Вёрстка', '[104] Сервер', 'Своя позиция'], ['[102] Вёрстка', '[104] Сервер', '[105] Звонок'])
    expect(second!.text).toBe(`Точно добавить? В счёте уже есть 2 поз. с такими же названиями — после добавления они задвоятся. ${NO_UNDO}`)
    // Одна совпавшая — тоже дубль.
    expect(writeConfirmations('append', ['[102] Вёрстка'], ['[102] Вёрстка', '[104] Сервер'])[1]!.text).toContain('уже есть 1 поз.')
  })

  it('«Добавить» в пустой счёт — тоже дважды: так просил владелец; дублей нет — о них не пугаем', () => {
    expect(writeConfirmations('append', [], ['x'])).toEqual([
      { text: 'Добавить 1 строку в счёт?', confirm: 'Да, добавить' },
      { text: `Точно добавить? ${NO_UNDO}`, confirm: 'Точно добавить' }
    ])
  })

  it('«Заменить» — один вопрос, если позиции уже есть; пустой счёт — без вопросов', () => {
    expect(writeConfirmations('replace', ['a', 'b', 'c', 'd'], ['x', 'y'])).toEqual([
      { text: 'В счёте уже 4 поз. — они будут удалены, вместо них встанут строки из задач. Заменить?', confirm: 'Заменить' }
    ])
    expect(writeConfirmations('replace', [], ['x', 'y'])).toEqual([])
  })
})

describe('шаги вопросов на странице', () => {
  it('«Добавить»: два «да» подряд — потом запись; помнит, о скольких позициях спросили', () => {
    const first = startConfirm('append', ['a'], ['x'])
    expect(first).toMatchObject({ mode: 'append', step: 0, existing: 1 })
    expect(first!.questions).toHaveLength(2)
    const second = answerYes(first!)
    expect(second).toMatchObject({ step: 1, existing: 1 })
    expect(answerYes(second!)).toBeNull()
  })

  it('«Заменить» в пустой счёт — вопросов нет, пишем сразу; с позициями — одно «да»', () => {
    expect(startConfirm('replace', [], ['x'])).toBeNull()
    const state = startConfirm('replace', ['a', 'b'], ['x'])
    expect(state).toMatchObject({ step: 0, existing: 2 })
    expect(answerYes(state!)).toBeNull()
  })
})

describe('positionsChanged — позиции счёта изменились после вопроса', () => {
  it('то же число — пишем; другое — стоп с объяснением', () => {
    expect(positionsChanged(2, 2)).toBeNull()
    // Позицию удалили — тоже изменение: вопрос называл другое число.
    expect(positionsChanged(3, 2)).toContain('было 3 поз., стало 2')
    expect(positionsChanged(0, 1)).toBe('Позиции счёта изменились, пока открыт предпросмотр: было 0 поз., стало 1. '
      + 'Ничего не записано — проверьте счёт и нажмите кнопку записи ещё раз.')
  })
})
