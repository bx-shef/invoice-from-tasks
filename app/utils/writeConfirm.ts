// Вопросы перед записью в счёт — чистые функции, чтобы текст, число вопросов и шаги проверял тест.
// «Добавить» спрашивает дважды, как Windows перед необратимым шагом (просьба владельца
// 2026-09-28): повторное добавление задваивает товары, а отменить его можно только руками.
//
// Вопросы — на странице (components/invoice/WriteConfirm.vue), а не window.confirm: на втором
// системном окне подряд Firefox и Chrome предлагают «запретить странице диалоги», и после этого
// confirm молча отвечает «нет» — кнопки записи перестали бы работать без единого слова (находка
// /code-review и программиста панели).

import type { WriteMode } from './writeOutcome'

/** Вопрос перед записью: текст и надпись кнопки согласия. */
export interface WriteQuestion {
  text: string
  /** Кнопка согласия: «Заменить», «Да, добавить», «Точно добавить». */
  confirm: string
}

/** «строку», «строки», «строк» — по числу. */
export function rowsWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'строку'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'строки'
  return 'строк'
}

const nameKey = (name: string) => name.trim().toLowerCase()

/**
 * Сколько добавляемых строк уже есть в счёте под тем же названием (без учёта регистра и пробелов
 * по краям). С «[ID]» в названии совпадение надёжное; без него — подсказка, а не доказательство.
 */
export function duplicateCount(existingNames: readonly string[], plannedNames: readonly string[]): number {
  const have = new Set(existingNames.map(nameKey))
  return plannedNames.filter(name => have.has(nameKey(name))).length
}

const NO_UNDO = 'Отменить добавление нельзя — лишние позиции придётся удалять в карточке счёта.'

/**
 * Вопросы по порядку; пустой список — спрашивать нечего. «Заменить» спрашивает, только если в счёте
 * уже есть позиции (их удалят). «Добавить» — всегда дважды: сначала что и куда, потом «точно?» с
 * тем, чем грозит повтор, — и числом строк, которые уже есть в счёте под теми же названиями.
 */
export function writeConfirmations(mode: WriteMode, existingNames: readonly string[], plannedNames: readonly string[]): WriteQuestion[] {
  const existing = existingNames.length
  if (mode === 'replace') {
    return existing > 0
      ? [{ text: `В счёте уже ${existing} поз. — они будут удалены, вместо них встанут строки из задач. Заменить?`, confirm: 'Заменить' }]
      : []
  }
  const planned = plannedNames.length
  const what = `${planned} ${rowsWord(planned)}`
  const dup = duplicateCount(existingNames, plannedNames)
  const risk = dup > 0
    ? `В счёте уже есть ${dup} поз. с такими же названиями — после добавления они задвоятся. `
    : existing > 0 ? 'Если эти задачи уже добавляли в счёт, позиции задвоятся. ' : ''
  return [
    {
      text: existing > 0
        ? `Добавить ${what} к ${existing} поз. счёта? Строки встанут после существующих.`
        : `Добавить ${what} в счёт?`,
      confirm: 'Да, добавить'
    },
    { text: `Точно добавить? ${risk}${NO_UNDO}`, confirm: 'Точно добавить' }
  ]
}

/** Идущие вопросы: какой задан сейчас и сколько позиций было в счёте, когда спросили. */
export interface ConfirmState {
  mode: WriteMode
  questions: WriteQuestion[]
  /** Номер текущего вопроса, с нуля. */
  step: number
  /** Позиций в счёте, о которых спросили: перед записью сверяется ({@link positionsChanged}). */
  existing: number
}

/** Начать вопросы; `null` — спрашивать нечего, можно писать сразу. */
export function startConfirm(mode: WriteMode, existingNames: readonly string[], plannedNames: readonly string[]): ConfirmState | null {
  const questions = writeConfirmations(mode, existingNames, plannedNames)
  return questions.length ? { mode, questions, step: 0, existing: existingNames.length } : null
}

/** Ответ «да»: следующий вопрос или `null` — все пройдены, пора писать. */
export function answerYes(state: ConfirmState): ConfirmState | null {
  return state.step + 1 < state.questions.length ? { ...state, step: state.step + 1 } : null
}

/**
 * Позиции счёта изменились с тех пор, как о них спросили (коллега или сам сотрудник добавил товар в
 * карточке, пока открыт предпросмотр): «Заменить» молча стёрло бы новый товар, а вопрос «Добавить»
 * называл бы не то число (находка /code-review). Текст ошибки или `null` — можно писать.
 */
export function positionsChanged(asked: number, now: number): string | null {
  return asked === now
    ? null
    : `Позиции счёта изменились, пока открыт предпросмотр: было ${asked} поз., стало ${now}. `
      + 'Ничего не записано — проверьте счёт и нажмите кнопку записи ещё раз.'
}
