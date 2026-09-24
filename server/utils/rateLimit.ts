// Ограничение частоты: обращения к BitrixGPT (ключ стоит денег, а нажимать кнопку можно сколько
// угодно), события портала и живые проверки фрейм-токена (ключи — IP клиента). Счётчик в памяти
// процесса — у нас один экземпляр сервера; при горизонтальном масштабировании понадобится общий
// (Redis), см. docs/ARCHITECTURE.md.

export interface WindowLimit {
  /** Сколько единиц разрешено в окне (запросов — или строк, если запрос весит больше 1). */
  max: number
  windowMs: number
}

/**
 * Пределы BitrixGPT: на сотрудника и на портал целиком. Единица — одна строка счёта в запросе
 * названий; консультация весит {@link CONSULT_WEIGHT}. Считать строки, а не запросы, пришлось
 * после того, как названия стали уходить пакетами по 25: лимит «30 запросов» не давал назвать
 * счёт длиннее 750 строк вообще (находка /code-review). 3000 строк за 10 минут — несколько
 * пересборок большого счёта; 30 000 за час — портал целиком.
 */
export const AI_LIMITS = {
  user: { max: 3000, windowMs: 10 * 60_000 },
  portal: { max: 30_000, windowMs: 60 * 60_000 }
} as const satisfies Record<string, WindowLimit>

/** Вес консультации в единицах лимита — как полный пакет названий. */
export const CONSULT_WEIGHT = 25

/** Потолок ключей в памяти: поток запросов с тысяч адресов не должен съесть память. */
export const MAX_WINDOW_KEYS = 50_000
/** Чистка устаревших ключей — раз в столько вызовов `take`, а не на каждом. */
const PRUNE_EVERY = 256

interface Bucket {
  windowMs: number
  /** Попадания: момент и вес. */
  hits: Array<[time: number, weight: number]>
}

export class SlidingWindow {
  readonly #buckets = new Map<string, Bucket>()
  #calls = 0

  constructor(readonly maxKeys: number = MAX_WINDOW_KEYS) {}

  /** Сколько ключей сейчас в памяти (для тестов и диагностики). */
  get size(): number {
    return this.#buckets.size
  }

  /**
   * Учитывает попытку весом `weight` сразу во всех окнах. `false` — хотя бы в одном окне не
   * хватает запаса, и тогда попытка не засчитывается НИГДЕ: иначе отказ по лимиту портала съедал
   * бы лимит сотрудника.
   */
  take(checks: Array<[key: string, limit: WindowLimit]>, now = Date.now(), weight = 1): boolean {
    const fresh = checks.map(([key, limit]) => {
      const hits = (this.#buckets.get(key)?.hits ?? []).filter(([t]) => t > now - limit.windowMs)
      const used = hits.reduce((sum, [, w]) => sum + w, 0)
      return { key, limit, hits, used }
    })
    const ok = fresh.every(({ limit, used }) => used + weight <= limit.max)
    for (const { key, limit, hits } of fresh) {
      if (ok) hits.push([now, weight])
      // Удалить и вставить заново: Map хранит порядок вставки, и свежие ключи уходят в конец —
      // при переполнении вытесняются давно не виденные.
      this.#buckets.delete(key)
      if (hits.length) this.#buckets.set(key, { windowMs: limit.windowMs, hits })
    }
    if (++this.#calls % PRUNE_EVERY === 0 || this.#buckets.size > this.maxKeys) this.#prune(now)
    return ok
  }

  /**
   * Снимает ключи, чьё СОБСТВЕННОЕ окно истекло (раньше окно было общим — час, и ключи с окном в
   * минуту жили в 60 раз дольше нужного). Если ключей всё ещё больше потолка — вытесняет самые
   * давно виденные до 90 % потолка, чтобы полный проход случался редко. Вытеснение сбрасывает
   * чужой счётчик, то есть делает лимит мягче, а не строже, — зато память ограничена.
   */
  #prune(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.hits.every(([t]) => t <= now - bucket.windowMs)) this.#buckets.delete(key)
    }
    if (this.#buckets.size <= this.maxKeys) return
    const target = Math.floor(this.maxKeys * 0.9)
    for (const key of this.#buckets.keys()) {
      if (this.#buckets.size <= target) break
      this.#buckets.delete(key)
    }
  }
}
