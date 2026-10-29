/**
 * Прогресс решений клиента на публичной странице (дизайн v2): «Решено N из M», доли полосы
 * и сумма к оплате по принятым работам.
 */
export type Decision = 'yes' | 'no' | 'later'

export interface DecisionProgress {
  yes: number
  no: number
  later: number
  /** Ждут решения (нет отметки). */
  wait: number
  all: number
  /** Решено — делаем или не делаем; «позже» решением не считается. */
  decided: number
  /** Сумма строк счёта по задачам «Делаем». */
  acceptedSum: number
}

export function decisionProgress(
  taskIds: number[],
  decisions: Record<number, Decision | undefined>,
  rows: ReadonlyArray<{ taskId?: number | null, sum: number | null }>
): DecisionProgress {
  const count = (d: Decision) => taskIds.filter(id => decisions[id] === d).length
  const yes = count('yes')
  const no = count('no')
  const later = count('later')
  const accepted = new Set(taskIds.filter(id => decisions[id] === 'yes'))
  const acceptedSum = rows.reduce((s, r) => s + (r.taskId && accepted.has(r.taskId) && r.sum ? r.sum : 0), 0)
  return { yes, no, later, wait: taskIds.length - yes - no - later, all: taskIds.length, decided: yes + no, acceptedSum: Math.round(acceptedSum * 100) / 100 }
}

/** «1 работа», «3 работы», «5 работ». */
export function worksLabel(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  const word = m10 === 1 && m100 !== 11 ? 'работа' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'работы' : 'работ'
  return `${n} ${word}`
}

/** После «из»: «из 1 работы», «из 2 работ», «из 21 работы». */
export function ofWorksLabel(n: number): string {
  return `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'работы' : 'работ'}`
}

/** «1 работа ждёт решения», «3 работы ждут решения». */
export function waitingLabel(n: number): string {
  return `${worksLabel(n)} ${n % 10 === 1 && n % 100 !== 11 ? 'ждёт' : 'ждут'} решения`
}

/** Код строки из приставки «[87-119884] » — мелко под названием. */
export function rowCode(name: string): string {
  return /^\[([^\]]*)\]/.exec(name)?.[1] ?? ''
}

/** Строка счёта без приставки «[87-119884] »; пустое название остаётся как есть. */
export function rowTitle(name: string): string {
  return name.replace(/^\[[^\]]*\]\s*/, '') || name
}

/**
 * Поле замечания с приставкой работы: прежняя приставка «…»: заменяется, итог не длиннее max
 * (подстановка обходит maxlength поля — режем название, текст клиента не трогаем).
 */
export function withRowPrefix(text: string, title: string, max: number): string {
  const rest = text.replace(/^«[^»]*»: /, '')
  const room = Math.max(0, max - rest.length - 4)
  const name = title.length > room ? `${title.slice(0, Math.max(0, room - 1))}…` : title
  return room > 1 ? `«${name}»: ${rest}` : rest
}

/**
 * Короткие названия документов (дизайн v2): «Акт (Беларусь) 63» → «Акт». Только простой вид
 * «Название (…) 63» / «Название 63»; иначе — как есть. Если короткие совпадут у разных
 * документов — для всех полные: плитки должны различаться.
 */
export function docTitles(titles: string[]): string[] {
  const short = titles.map((t) => {
    const m = /^([^()\d№]+?)\s*(?:\([^()]*\))?\s*№?\s*\d+$/.exec((t ?? '').trim())
    return m?.[1]?.trim() || t
  })
  return new Set(short).size === short.length ? short : titles
}
