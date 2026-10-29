// Экономика задач и счёта (решение владельца 2026-10-07): сколько вышло бы по формуле (часы ×
// цена часа) и сколько выставлено клиенту («Стоимость работ» или та же формула). Суммы — С НДС, как
// платит клиент (владелец: «1500 — это я выставил», без НДС было 1250 — непонятно). Дельта — в
// деньгах: «−1200» — мы в минусе, «200» — в плюсе; разница — в процентах к формуле. Строки с
// убытком или завышением больше порога (настройки) и задачи без времени или ставки — помечаются.
// Итог по счёту — JSON в поле счёта своего типа «Экономика счёта» (/uf/economics).

import type { DraftRow, FillMode, FillResult, TaskSource } from './fill'
import { roundMoney } from './money'
import { grossPrice } from './vat'

/** Пометка задачи: убыток, завышение, нет данных (время — оценка ИИ, нет ставки); `null` — в норме. */
export type EconomyFlag = 'loss' | 'over' | 'missing' | null

export interface TaskEconomy {
  taskId: number
  /** По формуле, с НДС. */
  formula: number
  /** Выставлено клиенту, с НДС (для «Стоимости работ» — ровно она). */
  billed: number
  /** Выставлено − формула. */
  delta: number
  /** Дельта к формуле, %; формулы нет (0) — `null`. */
  diffPercent: number | null
  /** Часы — оценка ИИ: в задаче нет затраченного времени. */
  estimated: boolean
  /** Часы задачи (после округления; для задачи без времени — оценка ИИ). */
  hours: number
  /** Выставлено «Стоимостью работ», а не формулой. */
  fixed: boolean
  flag: EconomyFlag
}

/** Процент до десятых. */
function percent(delta: number, base: number): number | null {
  return base > 0 ? Math.round(delta / base * 1000) / 10 : null
}

/** Пометка по порогу: оценка ИИ и задачи без ставки — «нет данных», затем убыток/завышение. */
export function flagOf(diffPercent: number | null, estimated: boolean, threshold: number): EconomyFlag {
  if (estimated || diffPercent === null) return 'missing'
  if (diffPercent < -threshold) return 'loss'
  if (diffPercent > threshold) return 'over'
  return null
}

/**
 * Экономика по задачам: строки задачи складываются (тип 2 — несколько строк). Задачи с ошибками
 * сборки (нет ставки) — «нет данных» с нулями: их видно в списке, а не молча нет.
 */
export function taskEconomics(result: Pick<FillResult, 'rows' | 'errors'>, threshold: number): TaskEconomy[] {
  const byTask = new Map<number, { formula: number, billed: number, estimated: boolean, hours: number, fixed: boolean }>()
  for (const row of result.rows) {
    const t = byTask.get(row.taskId) ?? { formula: 0, billed: 0, estimated: false, hours: 0, fixed: false }
    t.hours += row.hours ?? 0
    t.fixed ||= row.fixedGross !== undefined
    // С налогом: «Стоимость работ» — как записана, остальное — сумма строки плюс НДС.
    t.formula += grossPrice(row.formulaSum, row.taxRate)
    t.billed += row.fixedGross ?? grossPrice(row.sum, row.taxRate)
    t.estimated ||= !!row.estimated
    byTask.set(row.taskId, t)
  }
  const out: TaskEconomy[] = [...byTask.entries()].map(([taskId, t]) => {
    const formula = roundMoney(t.formula)
    const billed = roundMoney(t.billed)
    const delta = roundMoney(billed - formula)
    const diffPercent = percent(delta, formula)
    return { taskId, formula, billed, delta, diffPercent, estimated: t.estimated, hours: Math.round(t.hours * 100) / 100, fixed: t.fixed, flag: flagOf(diffPercent, t.estimated, threshold) }
  })
  for (const e of result.errors) {
    if (e.taskId && !byTask.has(e.taskId) && !out.some(o => o.taskId === e.taskId)) {
      out.push({ taskId: e.taskId, formula: 0, billed: 0, delta: 0, diffPercent: null, estimated: false, hours: 0, fixed: false, flag: 'missing' })
    }
  }
  return out.sort((a, b) => a.taskId - b.taskId)
}

/** Есть с чем сравнивать: без затраченных часов формула 0, и дельта равна всей сумме — не пишем её. */
export function hasDelta(e: Pick<TaskEconomy, 'formula'>): boolean {
  return e.formula > 0
}

/** Значения для UF задачи: разница, % и дельта. Формулы нет — обе пустые. */
export function taskFieldValues(e: TaskEconomy, fields: { diffPercent: string, delta: string }): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  if (fields.diffPercent) out[fields.diffPercent] = e.diffPercent ?? ''
  if (fields.delta) out[fields.delta] = hasDelta(e) ? e.delta : ''
  return out
}

/** Сколько задач кладём в JSON поля счёта — значение UF не резиновое. */
export const MAX_ECONOMY_TASKS = 100

/** Итог по счёту — значение поля «Экономика счёта» (JSON, версия `v`). */
export interface InvoiceEconomy {
  v: 1
  /** Когда посчитано, ISO. */
  at: string
  currency: string
  source: TaskSource
  mode: FillMode
  threshold: number
  formula: number
  billed: number
  delta: number
  diffPercent: number | null
  /** Прибыль, убыток или в ноль (дельта по модулю меньше копейки). */
  verdict: 'profit' | 'loss' | 'even'
  /** Сколько задач помечено: убыток, завышение, нет данных. */
  counts: { loss: number, over: number, missing: number }
  tasks: Array<Pick<TaskEconomy, 'taskId' | 'formula' | 'billed' | 'delta' | 'diffPercent' | 'flag'> & { title: string }>
}

export function invoiceEconomy(
  list: TaskEconomy[],
  meta: { at: Date, currency: string, source: TaskSource, mode: FillMode, threshold: number, titles: ReadonlyMap<number, string> }
): InvoiceEconomy {
  const formula = roundMoney(list.reduce((n, e) => n + e.formula, 0))
  const billed = roundMoney(list.reduce((n, e) => n + e.billed, 0))
  const delta = roundMoney(billed - formula)
  const counts = { loss: 0, over: 0, missing: 0 }
  for (const e of list) if (e.flag) counts[e.flag]++
  return {
    v: 1,
    at: meta.at.toISOString(),
    currency: meta.currency,
    source: meta.source,
    mode: meta.mode,
    threshold: meta.threshold,
    formula,
    billed,
    delta,
    diffPercent: percent(delta, formula),
    verdict: Math.abs(delta) < 0.01 ? 'even' : delta > 0 ? 'profit' : 'loss',
    counts,
    tasks: list.slice(0, MAX_ECONOMY_TASKS).map(e => ({
      taskId: e.taskId,
      title: (meta.titles.get(e.taskId) ?? '').slice(0, 120),
      formula: e.formula,
      billed: e.billed,
      delta: e.delta,
      diffPercent: e.diffPercent,
      flag: e.flag
    }))
  }
}

/** Разбор значения поля: JSON нашей версии; мусор — `null`. */
export function parseInvoiceEconomy(raw: unknown): InvoiceEconomy | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const o = JSON.parse(raw) as Partial<InvoiceEconomy>
    if (o?.v !== 1 || typeof o.billed !== 'number' || typeof o.formula !== 'number' || !Array.isArray(o.tasks)) return null
    return o as InvoiceEconomy
  } catch {
    return null
  }
}

/** Строки с пометкой — для подсветки предпросмотра (по задаче строки). */
export function rowFlag(row: Pick<DraftRow, 'taskId'>, list: TaskEconomy[]): EconomyFlag {
  return list.find(e => e.taskId === row.taskId)?.flag ?? null
}

/** Знак и деньги для пилюли: «+280,00» / «−204,60» (минус — U+2212, как в макете). */
function signedMoney(v: number): string {
  const abs = Math.abs(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${abs}`
}

/** Пилюля дельты в поле «Экономика счёта»: «−204,60 · −4,7%», в ноль — «в ноль» (дизайн v2). */
export function economyDeltaLabel(e: Pick<InvoiceEconomy, 'delta' | 'diffPercent' | 'verdict'>): string {
  if (e.verdict === 'even') return 'в ноль'
  const pct = e.diffPercent === null ? '' : ` · ${e.diffPercent > 0 ? '+' : e.diffPercent < 0 ? '−' : ''}${Math.abs(e.diffPercent).toLocaleString('ru-RU')}%`
  return `${signedMoney(e.delta)}${pct}`
}

/** «3 задачи с пометками» — склонение по числу. */
export function flaggedLabel(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  const word = m10 === 1 && m100 !== 11 ? 'задача' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'задачи' : 'задач'
  return `${n} ${word} с пометками`
}

/** Плитка «Часы» окна счёта: всего часов (до сотых), задач и сколько из них оценил ИИ. */
export function economyHours(items: readonly Pick<TaskEconomy, 'hours' | 'estimated'>[]): { total: number, tasks: number, estimated: number } {
  return {
    total: Math.round(items.reduce((sum, e) => sum + e.hours, 0) * 100) / 100,
    tasks: items.length,
    estimated: items.filter(e => e.estimated).length
  }
}
