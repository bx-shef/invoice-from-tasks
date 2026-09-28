import { describe, expect, it } from 'vitest'
import { answerYes, CONFIRM_ARM_MS, duplicateCount, openConfirm, positionsChanged, rowsWord, startConfirm, writeBlocker, writeConfirmations, type ExistingPosition } from '~/utils/writeConfirm'

const NO_UNDO = 'Отменить добавление нельзя — лишние позиции придётся удалять в карточке счёта.'

describe('rowsWord — «строку / строки / строк»', () => {
  it('по правилам русского числа', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(n => `${n} ${rowsWord(n)}`)).toEqual([
      '1 строку', '2 строки', '4 строки', '5 строк', '11 строк', '12 строк', '14 строк', '21 строку', '22 строки', '25 строк', '101 строку', '111 строк'
    ])
  })
})

describe('duplicateCount — добавляемые строки, которые уже есть в счёте под тем же названием', () => {
  it('без учёта регистра и лишних пробелов (как clampName); каждая добавляемая строка считается один раз', () => {
    expect(duplicateCount(['[102] Вёрстка', 'Дизайн '], ['[102] вёрстка', ' дизайн', 'Сервер'])).toBe(2)
    expect(duplicateCount(['Вёрстка  шапки'], ['Вёрстка шапки'])).toBe(1)
    expect(duplicateCount([], ['Вёрстка'])).toBe(0)
    expect(duplicateCount(['Вёрстка'], ['Вёрстка шапки'])).toBe(0)
  })

  it('считаются добавляемые строки, а не позиции счёта: три записи к одной позиции — три дубля', () => {
    expect(duplicateCount(['[10] Правки'], ['[10] Правки', '[10] Правки', '[10] Правки'])).toBe(3)
    expect(duplicateCount(['Вёрстка', 'Вёрстка', 'Вёрстка'], ['Вёрстка'])).toBe(1)
  })
})

describe('writeConfirmations — что спросить перед записью', () => {
  it('«Добавить» спрашивает дважды: что и куда, потом «точно?» — чем грозит повтор', () => {
    expect(writeConfirmations('append', ['a', 'b', 'c'], ['x', 'y'])).toEqual([
      { text: 'Добавить 2 строки к 3 поз. счёта? Строки встанут после существующих.', confirm: 'Да, добавить' },
      { text: `Точно добавить? Если эти задачи уже добавляли в счёт, позиции задвоятся. ${NO_UNDO}`, confirm: 'Точно добавить' }
    ])
  })

  it('те же названия уже в счёте — второй вопрос называет, сколько добавляемых строк задвоится', () => {
    const [, second] = writeConfirmations('append', ['[102] Вёрстка', '[104] Сервер', 'Своя позиция'], ['[102] Вёрстка', '[104] Сервер', '[105] Звонок'])
    expect(second!.text).toBe(`Точно добавить? Добавляемых строк, которые уже есть в счёте под теми же названиями: 2 — будут дубли. ${NO_UNDO}`)
    // Одна совпавшая — тоже дубль; число без местоимения — согласовывать нечего.
    expect(writeConfirmations('append', ['[102] Вёрстка'], ['[102] Вёрстка', '[104] Сервер'])[1]!.text).toContain('названиями: 1 — будут дубли')
    // Добавляемые с повтором: считаются они, а не позиции счёта (аргументы duplicateCount не переставлены).
    expect(writeConfirmations('append', ['[10] Правки'], ['[10] Правки', '[10] Правки'])[1]!.text).toContain('названиями: 2 — будут дубли')
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

const pos = (id: number, productName = `поз. ${id}`) => ({ id, productName })

describe('шаги вопросов на странице', () => {
  const T0 = 1_000_000
  const later = (ms: number) => T0 + ms

  it('«Добавить»: два «да» подряд — потом запись; помнит, о каких позициях спросили', () => {
    const first = startConfirm('append', [pos(7, 'a')], ['a'], T0)
    expect(first).toMatchObject({ mode: 'append', step: 0, existingIds: [7], askedAt: T0 })
    expect(first!.questions).toHaveLength(2)
    // Названия позиций — в вопросы: «a» уже в счёте.
    expect(first!.questions[1]!.text).toContain('названиями: 1 — будут дубли')
    const second = answerYes(first!, later(CONFIRM_ARM_MS))
    expect(second).toMatchObject({ step: 1, existingIds: [7], askedAt: later(CONFIRM_ARM_MS) })
    expect(answerYes(second!, later(2 * CONFIRM_ARM_MS))).toBeNull()
  })

  it('«Заменить» в пустой счёт — вопросов нет, пишем сразу; с позициями — одно «да»', () => {
    expect(startConfirm('replace', [], ['x'], T0)).toBeNull()
    const state = startConfirm('replace', [pos(1), pos(2)], ['x'], T0)
    expect(state).toMatchObject({ step: 0, existingIds: [1, 2] })
    expect(answerYes(state!, later(CONFIRM_ARM_MS))).toBeNull()
  })

  it('двойной клик: «да» раньше паузы не принимается — тот же вопрос; пауза — от каждого вопроса', () => {
    expect(CONFIRM_ARM_MS).toBeGreaterThanOrEqual(500)
    expect(CONFIRM_ARM_MS).toBeLessThanOrEqual(1000)
    const first = startConfirm('append', [], ['x'], T0)!
    expect(answerYes(first, later(CONFIRM_ARM_MS - 1))).toBe(first)
    const second = answerYes(first, later(CONFIRM_ARM_MS))!
    // Второй клик того же двойного — через 100 мс после первого: второй вопрос не проскочен.
    expect(answerYes(second, later(CONFIRM_ARM_MS + 100))).toBe(second)
    expect(answerYes(second, later(2 * CONFIRM_ARM_MS))).toBeNull()
  })
})

describe('openConfirm — нажата кнопка записи: сначала перечитать счёт, потом решать', () => {
  /** Счёт, который «меняется» при перечитывании: до него — одни позиции, после — другие. */
  const portal = (before: ExistingPosition[], after: ExistingPosition[], ok = true) => {
    let current = before
    const calls: string[] = []
    return {
      calls,
      deps: {
        refresh: async () => {
          calls.push('refresh')
          current = after
          return ok
        },
        positions: () => {
          calls.push('positions')
          return current
        },
        now: () => 42
      }
    }
  }

  it('вопрос — о позициях ПОСЛЕ перечитывания, а не на момент сбора строк', async () => {
    const { calls, deps } = portal([pos(1)], [pos(1), pos(2, 'x')])
    const opened = await openConfirm('append', ['x'], deps)
    expect(calls).toEqual(['refresh', 'positions'])
    expect(opened).toMatchObject({ kind: 'ask', state: { existingIds: [1, 2], askedAt: 42 } })
    if (opened.kind !== 'ask') throw new Error('ожидался вопрос')
    expect(opened.state.questions[0]!.text).toBe('Добавить 1 строку к 2 поз. счёта? Строки встанут после существующих.')
    expect(opened.state.questions[1]!.text).toContain('названиями: 1 — будут дубли')
  })

  it('перечитать не вышло или счёт изменился — стоп, ни вопросов, ни записи', async () => {
    const { calls, deps } = portal([pos(1)], [pos(1)], false)
    expect(await openConfirm('replace', ['x'], deps)).toEqual({ kind: 'stop' })
    expect(calls).toEqual(['refresh'])
  })

  it('«Заменить» в пустой (после перечитывания) счёт — писать сразу, со свежими ID', async () => {
    const { deps } = portal([pos(1)], [])
    expect(await openConfirm('replace', ['x'], deps)).toEqual({ kind: 'write', askedIds: [] })
  })
})

describe('positionsChanged — позиции счёта изменились после вопроса', () => {
  const tail = 'Ничего не записано — проверьте счёт и нажмите кнопку записи ещё раз.'

  it('тот же состав (в любом порядке) — пишем', () => {
    expect(positionsChanged([1, 2], [2, 1])).toBeNull()
    expect(positionsChanged([], [])).toBeNull()
  })

  it('добавили или удалили позицию — стоп с числами', () => {
    expect(positionsChanged([], [5])).toBe(`Позиции счёта изменились, пока открыт предпросмотр (было 0 поз., стало 1). ${tail}`)
    expect(positionsChanged([1, 2, 3], [1, 2])).toContain('было 3 поз., стало 2')
  })

  it('удалили одну и добавили другую — число то же, но стоп: «Заменить» стёрло бы новую', () => {
    expect(positionsChanged([1, 2, 3], [1, 2, 4])).toBe(`Позиции счёта изменились, пока открыт предпросмотр (их столько же, но состав другой). ${tail}`)
    // Повтор ID в ответе не маскирует пропавшую позицию.
    expect(positionsChanged([1, 2], [1, 1])).not.toBeNull()
  })
})

describe('writeBlocker — решение перед записью после перечитывания счёта', () => {
  it('счёт изменился (реквизиты, валюта, сделка) — stale, даже если позиции те же', () => {
    expect(writeBlocker('Реквизиты счёта изменились', [1], [1])).toEqual({ kind: 'stale', message: 'Реквизиты счёта изменились' })
  })

  it('ошибка перечитывания с пустым текстом — тоже stale, со своим текстом, а не «счёт свежий»', () => {
    expect(writeBlocker('', [1], [1])).toEqual({ kind: 'stale', message: 'Не удалось перечитать счёт перед записью — ничего не записано.' })
  })

  it('позиции изменились — changed; всё то же — пишем', () => {
    expect(writeBlocker(null, [1], [1, 2])).toMatchObject({ kind: 'changed' })
    expect(writeBlocker(null, [1], [1])).toBeNull()
  })
})
