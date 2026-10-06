// Справка и ИИ-чат по ней (по принципу toolsai, site/server/rag/core.mjs): публичные страницы —
// `docs/guide/NN-*.md`, фрагменты по `##`/`###`, поиск BM25 с облегчённым русским стеммером, без
// эмбеддингов и без зависимостей. Внутренние документы (`docs/*.md`) сюда не попадают: сервер читает
// только docs/guide (nuxt.config.ts → nitro.serverAssets), а `isPublicGuideFile` отсекает лишнее.

// --- Страницы ---------------------------------------------------------------

export interface KbPage {
  /** Имя файла без `.md`: `02-fill`. */
  slug: string
  title: string
  description: string
  /** Текст без заголовка `#`, штампа и строки описания. */
  markdown: string
}

/** Публичная страница справки: `NN-имя.md` (README каталога — для авторов, не для справки). */
export function isPublicGuideFile(name: string): boolean {
  return /^\d{2}-[a-z0-9-]+\.md$/.test(name)
}

/** Разбор файла справки: `# Заголовок`, штамп `> Last reviewed`, строка описания, текст. */
export function parseGuidePage(name: string, md: string): KbPage | null {
  if (!isPublicGuideFile(name)) return null
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const titleAt = lines.findIndex(l => /^#\s+/.test(l))
  if (titleAt < 0) return null
  const title = lines[titleAt]!.replace(/^#\s+/, '').trim()
  let i = titleAt + 1
  while (i < lines.length && (!lines[i]!.trim() || /^>\s*Last reviewed/i.test(lines[i]!))) i++
  // Первая строка-абзац после штампа — описание (если это не раздел).
  let description = ''
  if (i < lines.length && !/^#/.test(lines[i]!)) description = lines[i++]!.trim()
  return { slug: name.replace(/\.md$/, ''), title, description, markdown: lines.slice(i).join('\n').trim() }
}

/** Страницы по порядку номера в имени. */
export function guidePages(files: Array<{ name: string, md: string }>): KbPage[] {
  return files.map(f => parseGuidePage(f.name, f.md)).filter((p): p is KbPage => p !== null).sort((a, b) => a.slug.localeCompare(b.slug))
}

// --- Токены ------------------------------------------------------------------

const STOP = new Set(('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы почему зачем какие каких каким нее сейчас были куда всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это the a an and or of to in is for on with as by be at it this that').split(' '))

/** Окончания — от длинных к коротким (облегчённый Snowball: «ставки», «ставкой» → «ставк»). */
const ENDINGS = ['иями', 'ями', 'ами', 'иях', 'ией', 'ием', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ость', 'ости', 'ств', 'ться', 'тся', 'ешь', 'ете', 'ите', 'ает', 'яет', 'ует', 'ают', 'яют', 'уют', 'ала', 'яла', 'ила', 'ыла', 'ело', 'ать', 'ять', 'ить', 'еть', 'уть', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ой', 'ей', 'ий', 'ый', 'ую', 'юю', 'ом', 'ем', 'ам', 'ям', 'ах', 'ях', 'ов', 'ев', 'ия', 'ию', 'ии', 'ть', 'ла', 'ло', 'ли', 'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й']

export function stem(word: string): string {
  if (!/[а-яё]/.test(word)) return word
  const w = word.replace(/ё/g, 'е')
  for (const e of ENDINGS) if (w.length - e.length >= 3 && w.endsWith(e)) return w.slice(0, -e.length)
  return w
}

export function tokens(text: string): string[] {
  const out: string[] = []
  for (const raw of String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.-]*/gu) ?? []) {
    const w = raw.replace(/[.-]+$/, '')
    if (w.length < 2 || STOP.has(w)) continue
    out.push(stem(w))
    if (/[._-]/.test(w)) for (const p of w.split(/[._-]+/)) if (p.length >= 2 && !STOP.has(p)) out.push(stem(p))
  }
  return out
}

// --- Фрагменты ----------------------------------------------------------------

/** Заголовок раздела: текст и якорь. Явный якорь `{#id}` (FAQ) важнее вычисленного. */
export function headingOf(raw: string): { text: string, anchor: string } {
  const m = /^(.*?)\s*\{#([a-z0-9-]+)\}\s*$/.exec(raw)
  const text = (m ? m[1]! : raw).replace(/`/g, '').trim()
  return { text, anchor: m ? m[2]! : anchor(text) }
}

/** Вычисленный якорь: буквы и цифры, пробелы → «-», ведущая цифра — с «_». */
export function anchor(heading: string): string {
  const s = heading.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-')
  return /^\d/.test(s) ? `_${s}` : s
}

export interface KbChunk {
  title: string
  heading: string
  /** `slug` или `slug#якорь`. */
  url: string
  text: string
}

const MAX_CHUNK = 4000

/** Страница → вступление и каждый `##`/`###` отдельно. */
export function chunkPage(page: KbPage): KbChunk[] {
  const out: KbChunk[] = []
  let heading = ''
  let id = ''
  let buf: string[] = []
  let fence = false
  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) out.push({ title: page.title, heading, url: id ? `${page.slug}#${id}` : page.slug, text: text.slice(0, MAX_CHUNK) })
    buf = []
  }
  for (const line of page.markdown.split('\n')) {
    if (/^```/.test(line)) fence = !fence
    const h = !fence && /^#{2,3}\s+(.+?)\s*#*$/.exec(line)
    if (h) {
      flush()
      const parsed = headingOf(h[1]!)
      heading = parsed.text
      id = parsed.anchor
      continue
    }
    buf.push(line)
  }
  flush()
  return out
}

// --- Индекс и поиск (BM25) ----------------------------------------------------

interface Doc extends KbChunk {
  page: string
  tf: Record<string, number>
  len: number
}
interface Stats { df: Record<string, number>, avg: number, n: number }
export interface KbIndex {
  docs: Doc[]
  pages: Record<string, { tf: Record<string, number>, len: number }>
  chunkStats: Stats
  pageStats: Stats
}

function bm25(items: Array<{ tf: Record<string, number>, len: number }>): Stats {
  const df: Record<string, number> = {}
  for (const d of items) for (const t of Object.keys(d.tf)) df[t] = (df[t] ?? 0) + 1
  const avg = items.reduce((n, d) => n + d.len, 0) / (items.length || 1)
  return { df, avg, n: items.length }
}

function score(st: Stats, d: { tf: Record<string, number>, len: number }, q: string[], k1 = 1.2, b = 0.75): number {
  let s = 0
  for (const t of q) {
    const f = d.tf[t]
    if (!f) continue
    const df = st.df[t] ?? 0
    const idf = Math.log(1 + (st.n - df + 0.5) / (df + 0.5))
    s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / st.avg))
  }
  return s
}

/** Заголовки страницы и раздела весят втрое; фрагмент оценивается и вместе со своей страницей. */
export function buildIndex(chunks: KbChunk[]): KbIndex {
  const pages: KbIndex['pages'] = {}
  const docs = chunks.map((c): Doc => {
    const tf: Record<string, number> = {}
    const head = tokens(`${c.title} ${c.heading}`)
    const all = [...head, ...head, ...head, ...tokens(c.text)]
    for (const t of all) tf[t] = (tf[t] ?? 0) + 1
    const page = c.url.split('#')[0]!
    const p = (pages[page] ??= { tf: {}, len: 0 })
    if (!p.len) {
      for (const t of tokens(c.title)) {
        p.tf[t] = (p.tf[t] ?? 0) + 3
        p.len += 3
      }
    }
    for (const t of tokens(`${c.heading} ${c.text}`)) {
      p.tf[t] = (p.tf[t] ?? 0) + 1
      p.len++
    }
    return { ...c, page, tf, len: all.length }
  })
  return { docs, pages, chunkStats: bm25(docs), pageStats: bm25(Object.values(pages)) }
}

export function search(index: KbIndex, query: string, limit = 8, pageWeight = 0.5): Doc[] {
  const q = [...new Set(tokens(query))]
  if (!q.length) return []
  const ps: Record<string, number> = {}
  for (const [u, p] of Object.entries(index.pages)) ps[u] = score(index.pageStats, p, q)
  return index.docs
    .map((d) => {
      const own = score(index.chunkStats, d, q)
      return { d, s: own ? own + pageWeight * (ps[d.page] ?? 0) : 0 }
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => x.d)
}

/** Бюджет контекста для модели, символов (как в toolsai). */
export const KB_BUDGET = 24_000
export const KB_MAX_CHUNKS = 16

/** Контекст: сначала фрагменты обсуждаемой страницы, затем найденные — пока влезают в бюджет. */
export function selectChunks(index: KbIndex, query: string, page?: string, budget = KB_BUDGET, max = KB_MAX_CHUNKS): KbChunk[] {
  const own = page ? index.docs.filter(d => d.page === page) : []
  const found = search(index, query, 60).filter(d => d.page !== page)
  const out: KbChunk[] = []
  let size = 0
  for (const d of [...own, ...found]) {
    if (size + d.text.length > budget) continue
    out.push({ title: d.title, heading: d.heading, url: d.url, text: d.text })
    size += d.text.length
    if (out.length >= max) break
  }
  return out
}

// --- Чат ------------------------------------------------------------------------

export interface KbMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Сколько последних сообщений уходит модели и предел вопроса. */
export const KB_HISTORY = 10
export const KB_QUESTION_MAX = 2000

/** Разбор истории из запроса: только user/assistant, текст обрезан, последние KB_HISTORY; последнее — вопрос. */
export function parseKbMessages(raw: unknown): KbMessage[] | null {
  if (!Array.isArray(raw)) return null
  const out: KbMessage[] = []
  for (const m of raw.slice(-KB_HISTORY)) {
    if (!m || typeof m !== 'object') return null
    const { role, content } = m as { role?: unknown, content?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) return null
    out.push({ role, content: content.slice(0, role === 'user' ? KB_QUESTION_MAX : 8000) })
  }
  return out.length && out[out.length - 1]!.role === 'user' ? out : null
}

/** Фрагменты одной страницы — одним блоком: заголовок, `URL:`, разделы с якорями. */
export function renderChunks(chosen: KbChunk[]): string {
  const byPage = new Map<string, KbChunk[]>()
  for (const c of chosen) {
    const page = c.url.split('#')[0]!
    byPage.set(page, [...(byPage.get(page) ?? []), c])
  }
  return [...byPage.entries()].map(([page, list]) => [
    `# ${list[0]!.title}`,
    `URL: /help?p=${page}`,
    ...list.map(c => c.heading ? `## ${c.heading} (${helpUrl(c.url)})\n${c.text}` : c.text)
  ].join('\n\n')).join('\n\n---\n\n')
}

/** `slug#якорь` → адрес справки в приложении. */
export function helpUrl(url: string): string {
  const [page, hash] = url.split('#')
  return `/help?p=${page}${hash ? `#${hash}` : ''}`
}

/** Системный промпт: только публичная справка, ссылки на её разделы, без выдумок. */
export function kbSystemPrompt(chosen: KbChunk[]): string {
  return [
    'Ты — помощник по приложению Битрикс24 «Счёт из задач»: оно заполняет товарную часть счёта по задачам и затраченному времени, показывает клиенту расшифровку счёта по QR-коду и ведёт согласование.',
    'Отвечай по-русски, коротко, по шагам, с точными названиями кнопок и настроек из справки ниже. Заголовки markdown не используй; выделяй жирным.',
    'Давай ссылки вида [название](URL) — на страницу из строки «URL:» или на раздел из скобок после его заголовка. Если ответа в справке нет — так и скажи и предложи обратиться к администратору портала.',
    'Не придумывай кнопки, настройки, поля и правила, которых нет в справке ниже; общих советов «от себя» не давай.',
    'Ты знаешь только публичную справку. Внутренней документации (устройство сервера, правила разработки, ключи и переменные окружения) у тебя нет: на такие вопросы отвечай, что в справке этого нет.',
    '',
    '=== РАЗДЕЛЫ СПРАВКИ, ПОДОБРАННЫЕ ПОД ВОПРОС ===',
    renderChunks(chosen)
  ].join('\n')
}

/** Источники для ответа: страницы, чьи фрагменты ушли в контекст. */
export function kbSources(chosen: KbChunk[], pages: KbPage[]): Array<{ title: string, url: string }> {
  const seen = new Set<string>()
  const out: Array<{ title: string, url: string }> = []
  for (const c of chosen) {
    const slug = c.url.split('#')[0]!
    if (seen.has(slug)) continue
    seen.add(slug)
    out.push({ title: pages.find(p => p.slug === slug)?.title ?? c.title, url: helpUrl(slug) })
  }
  return out
}
