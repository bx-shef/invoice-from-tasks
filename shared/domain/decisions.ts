// Решения клиента по каждой задаче счёта (просьба владельца 2026-10-23): на странице согласования
// клиент отмечает работу «подтверждаю» или «не делаем» — по одной или все разом. Решения живут в
// поле счёта «Решения клиента по задачам» (строка JSON, создаёт «Создать поля»): нет поля в счёте —
// кнопок нет. Отказ — дело ответственному; все подтверждены — счёт согласован.
// Чистые правила: разбор, проверка ввода, слияние, итог и текст дела.

/** Код поля счёта с решениями (строка JSON). */
export const INVOICE_DECISIONS_FIELD = 'UF_CRM_SMART_INVOICE_SH_IFT_TASKS'

export type Decision = 'yes' | 'no'

/** Решение по задаче: что и когда (ISO). */
export interface TaskDecision { d: Decision, at: string }

/** Решения по ID задачи. */
export type Decisions = Record<number, TaskDecision>

const isDecision = (v: unknown): v is Decision => v === 'yes' || v === 'no'

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
    out[id] = { d: rec.d, at: typeof rec.at === 'string' ? rec.at : '' }
  }
  return out
}

export function serializeDecisions(d: Decisions): string {
  return JSON.stringify(d)
}

/**
 * Ввод клиента `{ "<taskId>": "yes" | "no" }` → решения только по задачам ЭТОГО счёта
 * (`allowed`); чужие ID и мусор отбрасываются. Пусто — `null`.
 */
export function cleanDecisionInput(raw: unknown, allowed: readonly number[]): Record<number, Decision> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const ok = new Set(allowed)
  const out: Record<number, Decision> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(k)
    if (ok.has(id) && isDecision(v)) out[id] = v
  }
  return Object.keys(out).length ? out : null
}

/** Новые решения поверх старых; `changed` — задачи, где решение появилось или сменилось. */
export function mergeDecisions(prev: Decisions, input: Record<number, Decision>, now: Date): { next: Decisions, changed: Array<{ taskId: number, d: Decision }> } {
  const next: Decisions = { ...prev }
  const changed: Array<{ taskId: number, d: Decision }> = []
  for (const [k, d] of Object.entries(input)) {
    const id = Number(k)
    if (prev[id]?.d === d) continue
    next[id] = { d, at: now.toISOString() }
    changed.push({ taskId: id, d })
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
