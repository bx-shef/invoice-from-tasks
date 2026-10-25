// Решения клиента по каждой задаче счёта (просьба владельца 2026-10-23): на странице согласования
// клиент отмечает работу «подтверждаю» или «не делаем» — по одной или все разом. Решения живут в
// поле счёта «Решения клиента по задачам» (строка JSON, создаёт «Создать поля»): нет поля в счёте —
// кнопок нет. Отказ — дело ответственному; все подтверждены — счёт согласован.
// Чистые правила: разбор, проверка ввода, слияние, итог и текст дела.

/** Код поля счёта с решениями (строка JSON). */
export const INVOICE_DECISIONS_FIELD = 'UF_CRM_SMART_INVOICE_SH_IFT_TASKS'

export type Decision = 'yes' | 'no' | 'later'

/**
 * На сколько клиент откладывает решение по работе («Отложить», владелец 2026-10-25): решения
 * сейчас нет — вернёмся к работе после `until`.
 */
export const POSTPONE_PERIODS = { '1w': '1 неделя', '2w': '2 недели', '1m': '1 месяц', '6m': 'полгода' } as const
export type PostponePeriod = keyof typeof POSTPONE_PERIODS

/** Ввод клиента по задаче: решение или «отложить на срок» (`later:1w`). */
export type DecisionInput = 'yes' | 'no' | `later:${PostponePeriod}`

/** Решение по задаче: что и когда (ISO); у «отложить» — до какого дня (ISO-дата). */
export interface TaskDecision { d: Decision, at: string, until?: string }

/** Решения по ID задачи. */
export type Decisions = Record<number, TaskDecision>

const isDecision = (v: unknown): v is Decision => v === 'yes' || v === 'no' || v === 'later'
const isInput = (v: unknown): v is DecisionInput =>
  v === 'yes' || v === 'no' || (typeof v === 'string' && v.startsWith('later:') && v.slice(6) in POSTPONE_PERIODS)

/** До какого дня отложено: от `now` на выбранный срок (ISO-дата, без времени). */
export function postponeUntil(period: PostponePeriod, now: Date): string {
  const d = new Date(now)
  if (period === '1w') d.setUTCDate(d.getUTCDate() + 7)
  else if (period === '2w') d.setUTCDate(d.getUTCDate() + 14)
  else if (period === '1m') d.setUTCMonth(d.getUTCMonth() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 6)
  return d.toISOString().slice(0, 10)
}

/** Значение поля счёта → решения; мусор и чужой формат — пусто (поле правят и руками). */
export function parseDecisions(raw: unknown): Decisions {
  let o: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return {}
    try {
      o = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
  const out: Decisions = {}
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const id = Number(k)
    const rec = v as Record<string, unknown> | null
    if (!Number.isInteger(id) || id <= 0 || !rec || !isDecision(rec.d)) continue
    out[id] = { d: rec.d, at: typeof rec.at === 'string' ? rec.at : '', ...(rec.d === 'later' && typeof rec.until === 'string' ? { until: rec.until } : {}) }
  }
  return out
}

export function serializeDecisions(d: Decisions): string {
  return JSON.stringify(d)
}

/**
 * Ввод клиента `{ "<taskId>": "yes" | "no" | "later:1w" }` → решения только по задачам ЭТОГО счёта
 * (`allowed`); чужие ID и мусор отбрасываются. Пусто — `null`.
 */
export function cleanDecisionInput(raw: unknown, allowed: readonly number[]): Record<number, DecisionInput> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const ok = new Set(allowed)
  const out: Record<number, DecisionInput> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(k)
    if (ok.has(id) && isInput(v)) out[id] = v
  }
  return Object.keys(out).length ? out : null
}

/** Новые решения поверх старых; `changed` — задачи, где решение появилось или сменилось. */
export function mergeDecisions(prev: Decisions, input: Record<number, DecisionInput>, now: Date): { next: Decisions, changed: Array<{ taskId: number, d: Decision, until?: string }> } {
  const next: Decisions = { ...prev }
  const changed: Array<{ taskId: number, d: Decision, until?: string }> = []
  for (const [k, v] of Object.entries(input)) {
    const id = Number(k)
    const d: Decision = v.startsWith('later:') ? 'later' : v as Decision
    const until = d === 'later' ? postponeUntil(v.slice(6) as PostponePeriod, now) : undefined
    if (prev[id]?.d === d && prev[id]?.until === until) continue
    next[id] = { d, at: now.toISOString(), ...(until ? { until } : {}) }
    changed.push({ taskId: id, d, ...(until ? { until } : {}) })
  }
  return { next, changed }
}

/** Итог по задачам счёта: сколько подтверждено, отклонено, без решения; все ли подтверждены. */
export function decisionSummary(d: Decisions, taskIds: readonly number[]): { yes: number, no: number, open: number, allYes: boolean } {
  let yes = 0
  let no = 0
  for (const id of taskIds) {
    if (d[id]?.d === 'yes') yes++
    else if (d[id]?.d === 'no') no++
  }
  const open = taskIds.length - yes - no
  return { yes, no, open, allYes: taskIds.length > 0 && yes === taskIds.length }
}

/** Название дела ответственному об отказе — по нему видно в таймлайне, что случилось. */
export const DECLINED_TITLE = 'Клиент отказался от работ'

/** Текст дела об отказе: какие задачи клиент «не делаем» (названия — из страницы). */
export function declinedText(taskIds: readonly number[], titles: ReadonlyMap<number, string>): string {
  return taskIds.map(id => `#${id} ${titles.get(id) ?? ''}`.trim()).join('\n')
}

/** Название дела ответственному об отложенных работах. */
export const POSTPONED_TITLE = 'Клиент отложил решение по работам'

/** Текст дела: какие задачи отложены и до какого дня. */
export function postponedText(items: ReadonlyArray<{ taskId: number, until?: string }>, titles: ReadonlyMap<number, string>): string {
  return items.map(i => `#${i.taskId} ${titles.get(i.taskId) ?? ''}`.trim() + (i.until ? ` — до ${i.until.split('-').reverse().join('.')}` : '')).join('\n')
}
