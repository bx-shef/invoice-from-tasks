// Вопросы перед записью в счёт — чистые функции, чтобы текст, число вопросов и шаги проверял тест.
// «Добавить» спрашивает дважды, как Windows перед необратимым шагом (просьба владельца
// 2026-09-28): повторное добавление задваивает товары, а отменить его можно только руками.
//
// Вопросы — на странице (components/invoice/WriteConfirm.vue), а не window.confirm: на втором
// системном окне подряд Firefox и Chrome предлагают «запретить странице диалоги», и после этого
// confirm молча отвечает «нет» — кнопки записи перестали бы работать без единого слова (находка
// /code-review и программиста панели).

import { clampName } from '#shared/domain/fill'
import type { ExistingRow } from '#shared/domain/invoice'
import type { WriteMode } from './writeOutcome'

/**
 * Пауза после каждого вопроса, пока ответ «да» не принимается: двойной клик по «Да, добавить»
 * иначе попадал бы во вторую кнопку на том же месте и отвечал «да» на вопрос, которого не
 * прочли (находка второго круга). Системный `confirm` второй клик глотал сам. Правило — в
 * {@link answerYes} (с тестом); кнопка на странице лишь показывает его, неактивная на это время.
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

/**
 * Название для сравнения — как его запишет приложение (`clampName`: пробелы схлопнуты, длинное
 * обрезано), без регистра. Два длинных названия с общим началом совпадут — но в счёте они и
 * лягут одинаково обрезанными, для клиента это тот же дубль.
 */
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
  // Без местоимения: «1 … они задвоятся» не согласуется с числом (находка третьего круга).
  const risk = dup > 0
    ? `Добавляемых строк, которые уже есть в счёте под теми же названиями: ${dup} — будут дубли. `
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
export type ExistingPosition = Pick<ExistingRow, 'id' | 'productName'>

/** Идущие вопросы: какой задан сейчас и какие позиции были в счёте, когда спросили. */
export interface ConfirmState {
  mode: WriteMode
  questions: WriteQuestion[]
  /** Номер текущего вопроса, с нуля. */
  step: number
  /** ID позиций счёта, о которых спросили: перед записью сверяются ({@link positionsChanged}). */
  existingIds: number[]
  /**
   * Когда задан текущий вопрос, мс по монотонным часам (`performance.now()`): «да» раньше
   * `askedAt + CONFIRM_ARM_MS` не принимается. Не `Date.now()`: системное время переводят (NTP,
   * сон), а таймер кнопки идёт по монотонным — кнопка стала бы активной, а «да» молча не
   * принималось бы (находка четвёртого круга).
   */
  askedAt: number
}

/** Начать вопросы; `null` — спрашивать нечего, можно писать сразу. `now` — `performance.now()`. */
export function startConfirm(mode: WriteMode, existing: readonly ExistingPosition[], plannedNames: readonly string[], now: number): ConfirmState | null {
  const questions = writeConfirmations(mode, existing.map(p => p.productName), plannedNames)
  return questions.length ? { mode, questions, step: 0, existingIds: existing.map(p => p.id), askedAt: now } : null
}

/**
 * Ответ «да» в момент `now`: следующий вопрос, `null` — все пройдены, пора писать, или тот же
 * `state` — ответ слишком ранний ({@link CONFIRM_ARM_MS}), вопрос не прочли.
 */
export function answerYes(state: ConfirmState, now: number): ConfirmState | null {
  if (now < state.askedAt + CONFIRM_ARM_MS) return state
  return state.step + 1 < state.questions.length ? { ...state, step: state.step + 1, askedAt: now } : null
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

/** Что делать после нажатия кнопки записи ({@link openConfirm}). */
export type OpenResult = { kind: 'ask', state: ConfirmState } | { kind: 'write', askedIds: number[] } | { kind: 'stop' }

/** Откуда {@link openConfirm} берёт счёт и время — внедряются, чтобы порядок проверял тест. */
export interface OpenDeps {
  /** Перечитать счёт и позиции; `false` — не вышло или счёт изменился (сообщение — на нём). */
  refresh: () => Promise<boolean>
  /** Позиции счёта — после перечитывания. */
  positions: () => readonly ExistingPosition[]
  /** Монотонное время, мс (`performance.now()`). */
  now: () => number
}

/**
 * Нажата кнопка записи: сначала перечитать счёт, потом решать — спросить (`ask`), писать сразу
 * (`write`: «Заменить» в пустой счёт) или остановиться (`stop`: перечитать не вышло или счёт
 * изменился). Вопросы — о позициях после перечитывания, а не на момент сбора строк (находки
 * третьего и четвёртого кругов: решение — в чистом модуле, порядок ловит тест).
 */
export async function openConfirm(mode: WriteMode, plannedNames: readonly string[], deps: OpenDeps): Promise<OpenResult> {
  if (!await deps.refresh()) return { kind: 'stop' }
  const existing = deps.positions()
  const state = startConfirm(mode, existing, plannedNames, deps.now())
  return state ? { kind: 'ask', state } : { kind: 'write', askedIds: existing.map(p => p.id) }
}

/** Итог перечитывания счёта: не прочитался или изменился со сбора строк. */
export interface InvoiceCheck {
  /** Текст ошибки чтения (может быть пустым); `null` — прочитан. */
  readError: string | null
  /** Что изменилось со сбора строк (invoiceChangedSince); `null` — ничего. */
  changed: string | null
}

/** Почему запись не пошла после перечитывания счёта. */
export interface WriteBlock {
  /**
   * `stale` — счёт изменился (реквизиты, валюта, сделка): строки не те — предпросмотр сбросить,
   * ошибкой. `unread` — счёт не прочитался (сбой сети) и `positions` — изменились позиции: строки
   * верны — предпросмотр оставить, сообщение под кнопками, нажать ещё раз.
   */
  kind: 'stale' | 'unread' | 'positions'
  message: string
}

/**
 * Решение после перечитывания — одно для вопроса (`askedIds = null`: позиции ещё не с чем сверять)
 * и для записи; чистой функцией, чтобы его ловил тест (находки второго–пятого кругов: перед
 * вопросом и перед записью сбой чтения трактовался по-разному). Сбой чтения не стирает
 * предпросмотр: повторить нажатие дешевле, чем собирать строки заново (и тратить BitrixGPT).
 */
export function writeBlocker(check: InvoiceCheck, askedIds: readonly number[] | null, nowIds: readonly number[]): WriteBlock | null {
  // `!== null`, а не «если непусто»: пустой текст ошибки — тоже сбой, а не «счёт прочитан».
  if (check.readError !== null) {
    return { kind: 'unread', message: `Не удалось перечитать счёт (${check.readError || 'без описания'}) — ничего не записано. Попробуйте ещё раз.` }
  }
  if (check.changed) return { kind: 'stale', message: check.changed }
  const changed = askedIds === null ? null : positionsChanged(askedIds, nowIds)
  return changed ? { kind: 'positions', message: changed } : null
}
