// Ограничение частоты обращений к BitrixGPT: ключ стоит денег, а любой сотрудник портала
// может нажимать кнопку сколько угодно. Счётчик в памяти процесса — у нас один экземпляр
// сервера; при горизонтальном масштабировании понадобится общий (Redis), см. docs/ARCHITECTURE.md.

export interface WindowLimit {
  /** Сколько запросов разрешено в окне. */
  max: number
  windowMs: number
}

/** Пределы по умолчанию: на сотрудника и на портал целиком. */
export const AI_LIMITS = {
  user: { max: 30, windowMs: 10 * 60_000 },
  portal: { max: 300, windowMs: 60 * 60_000 }
} as const satisfies Record<string, WindowLimit>

export class SlidingWindow {
  readonly #hits = new Map<string, number[]>()

  /**
   * Учитывает попытку сразу во всех окнах. `false` — хотя бы одно исчерпано, и тогда попытка
   * не засчитывается НИГДЕ: иначе отказ по лимиту портала съедал бы лимит сотрудника.
   */
  take(checks: Array<[key: string, limit: WindowLimit]>, now = Date.now()): boolean {
    const fresh = checks.map(([key, limit]) => {
      const recent = (this.#hits.get(key) ?? []).filter(t => t > now - limit.windowMs)
      return { key, limit, recent }
    })
    for (const { key, recent } of fresh) this.#hits.set(key, recent)
    if (fresh.some(({ limit, recent }) => recent.length >= limit.max)) return false
    for (const { recent } of fresh) recent.push(now)
    if (this.#hits.size > 10_000) this.#prune(now)
    return true
  }

  #prune(now: number): void {
    for (const [key, times] of this.#hits) {
      if (times.every(t => t < now - 60 * 60_000)) this.#hits.delete(key)
    }
  }
}
