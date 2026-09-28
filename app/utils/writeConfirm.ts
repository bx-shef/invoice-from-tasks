// Вопросы перед записью в счёт — чистые функции, чтобы текст, число вопросов и шаги проверял тест.
// «Добавить» спрашивает дважды, как Windows перед необратимым шагом (просьба владельца
// 2026-09-28): повторное добавление задваивает товары, а отменить его можно только руками.
//
// Вопросы — на странице (components/invoice/WriteConfirm.vue), а не window.confirm: на втором
// системном окне подряд Firefox и Chrome предлагают «запретить странице диалоги», и после этого
// confirm молча отвечает «нет» — кнопки записи перестали бы работать без единого слова (находка
// /code-review и программиста панели).

import { clampName } from '#shared/domain/fill'
import type { WriteMode } from './writeOutcome'

/**
 * Пауза, пока кнопка согласия неактивна после каждого вопроса: двойной клик по «Да, добавить»
 * иначе попадал бы во вторую кнопку на том же месте и отвечал «да» на вопрос, которого не
 * прочли (находка второго круга). Системный `confirm` второй клик глотал сам.
 */
export const CONFIRM_ARM_MS = 700

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

/** Название для сравнения — как его запишет приложение (`clampName`: пробелы схлопнуты), без регистра. */
const nameKey = (name: string) => clampName(name).toLocaleLowerCase('ru')

/**
 * Сколько ДОБАВЛЯЕМЫХ строк совпадает по названию с позициями счёта (регистр и лишние пробелы не
 * важны): столько строк задвоится. Считаются добавляемые, а не позиции счёта: три записи «[10]
 * Правки» к одной такой позиции — три дубля. С «[ID]» в названии совпадение надёжное; без него —
 * подсказка, а не доказательство.
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
    ? `${dup} из добавляемых строк уже есть в счёте под теми же названиями — они задвоятся. `
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

/** Позиция счёта — то, что нужно вопросам: ID для сверки перед записью и название для дублей. */
export interface ExistingPosition {
  id: number
  productName: string
}

/** Идущие вопросы: какой задан сейчас и какие позиции были в счёте, когда спросили. */
export interface ConfirmState {
  mode: WriteMode
  questions: WriteQuestion[]
  /** Номер текущего вопроса, с нуля. */
  step: number
  /** ID позиций счёта, о которых спросили: перед записью сверяются ({@link positionsChanged}). */
  existingIds: number[]
}

/** Начать вопросы; `null` — спрашивать нечего, можно писать сразу. */
export function startConfirm(mode: WriteMode, existing: readonly ExistingPosition[], plannedNames: readonly string[]): ConfirmState | null {
  const questions = writeConfirmations(mode, existing.map(p => p.productName), plannedNames)
  return questions.length ? { mode, questions, step: 0, existingIds: existing.map(p => p.id) } : null
}

/** Ответ «да»: следующий вопрос или `null` — все пройдены, пора писать. */
export function answerYes(state: ConfirmState): ConfirmState | null {
  return state.step + 1 < state.questions.length ? { ...state, step: state.step + 1 } : null
}

/**
 * Позиции счёта изменились с тех пор, как о них спросили (коллега или сам сотрудник добавил товар в
 * карточке, пока открыт предпросмотр): «Заменить» молча стёрло бы новый товар, а вопрос «Добавить»
 * называл бы не то число (находка /code-review). Сверяется состав по ID, а не число: «удалили одну,
 * добавили другую» число не меняет (находка второго круга). Текст или `null` — можно писать.
 */
export function positionsChanged(askedIds: readonly number[], nowIds: readonly number[]): string | null {
  const asked = new Set(askedIds)
  const now = new Set(nowIds)
  if (asked.size === now.size && [...now].every(id => asked.has(id))) return null
  const how = askedIds.length === nowIds.length
    ? 'их столько же, но состав другой'
    : `было ${askedIds.length} поз., стало ${nowIds.length}`
  return `Позиции счёта изменились, пока открыт предпросмотр (${how}). `
    + 'Ничего не записано — проверьте счёт и нажмите кнопку записи ещё раз.'
}

/** Почему запись не пошла после перечитывания счёта. */
export interface WriteBlock {
  /**
   * `stale` — счёт изменился (реквизиты, валюта, сделка) или не перечитан: строки не те, предпросмотр
   * сбросить. `changed` — изменились позиции: строки верны, предпросмотр оставить, спросить заново.
   */
  kind: 'stale' | 'changed'
  message: string
}

/**
 * Решение перед записью — чистой функцией, чтобы его ловил тест (CLAUDE.md: решение — в чистом
 * модуле, находка второго круга): `stale` — итог invoiceChangedSince или ошибка перечитывания,
 * `askedIds` — позиции, о которых спросили, `nowIds` — позиции перечитанного счёта.
 */
export function writeBlocker(stale: string | null, askedIds: readonly number[], nowIds: readonly number[]): WriteBlock | null {
  if (stale) return { kind: 'stale', message: stale }
  const changed = positionsChanged(askedIds, nowIds)
  return changed ? { kind: 'changed', message: changed } : null
}
