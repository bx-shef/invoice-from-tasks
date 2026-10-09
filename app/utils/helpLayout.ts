// Раскладка справки по образцу сайта toolsai (helpdesk): оглавление статьи, поиск по разделам,
// соседние страницы. Чистые функции — без DOM и Vue, проверяются в tests/helpLayout.test.ts.

import { headingOf } from '#shared/domain/kb'
import type { KbPage } from '#shared/domain/kb'

export interface TocLink { id: string, text: string, depth: 2 | 3 }

/** Строки markdown вне блоков кода: заголовок внутри ``` — не заголовок. */
function linesOutsideCode(markdown: string): string[] {
  const out: string[] = []
  let fence = false
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence
      continue
    }
    if (!fence) out.push(line)
  }
  return out
}

/** Оглавление: разделы `##` и `###` с теми же якорями, что ставит renderHelp. */
export function tocOf(markdown: string): TocLink[] {
  const out: TocLink[] = []
  for (const line of linesOutsideCode(markdown)) {
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!m) continue
    const { text, anchor } = headingOf(m[2]!)
    out.push({ id: anchor, text, depth: m[1]!.length as 2 | 3 })
  }
  return out
}

/** Плашка «В статье:» под заголовком — разделы второго уровня, не больше восьми. */
export function previewOf(toc: TocLink[]): TocLink[] {
  return toc.filter(l => l.depth === 2).slice(0, 8)
}

export interface SearchSection {
  slug: string
  /** Якорь раздела; пусто — начало страницы. */
  anchor: string
  title: string
  /** Где раздел: заголовок страницы (у начала страницы — пусто). */
  crumb: string
  text: string
}

/** Разделы для поиска: начало страницы (заголовок, описание, вводный текст) и каждый `##`/`###`. */
export function searchSectionsOf(pages: KbPage[]): SearchSection[] {
  const out: SearchSection[] = []
  for (const p of pages) {
    let cur: SearchSection = { slug: p.slug, anchor: '', title: p.title, crumb: '', text: p.description }
    out.push(cur)
    for (const line of linesOutsideCode(p.markdown)) {
      const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line)
      if (m) {
        const { text, anchor } = headingOf(m[2]!)
        cur = { slug: p.slug, anchor, title: text, crumb: p.title, text: '' }
        out.push(cur)
      } else if (line.trim()) {
        cur.text += ` ${line.trim()}`
      }
    }
  }
  return out
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

export interface SearchHit { slug: string, anchor: string, title: string, crumb: string, score: number }

/**
 * Поиск как в toolsai (HdSearch): каждое слово запроса должно найтись в разделе; слово в
 * заголовке — 3 очка, в тексте — 1. Запрос короче двух букв — пусто.
 */
export function searchHelp(sections: SearchSection[], query: string, limit = 8): SearchHit[] {
  const q = norm(query.trim())
  if (q.length < 2) return []
  const words = q.split(/\s+/).filter(Boolean)
  const hits: SearchHit[] = []
  for (const s of sections) {
    const title = norm(s.title)
    const text = norm(s.text)
    let score = 0
    let all = true
    for (const w of words) {
      if (title.includes(w)) score += 3
      else if (text.includes(w)) score += 1
      else {
        all = false
        break
      }
    }
    if (all) hits.push({ slug: s.slug, anchor: s.anchor, title: s.title, crumb: s.crumb, score })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Адрес раздела справки внутри приложения. */
export function helpHref(slug: string, anchor = ''): string {
  return `/help?p=${encodeURIComponent(slug)}${anchor ? `#${anchor}` : ''}`
}

/** Соседние страницы для навигации «← Назад / Дальше →» внизу статьи. */
export function surroundOf<T extends { slug: string }>(pages: T[], slug: string): [T | null, T | null] {
  const i = pages.findIndex(p => p.slug === slug)
  if (i < 0) return [null, null]
  return [pages[i - 1] ?? null, pages[i + 1] ?? null]
}

/** Вопрос «Обсудить с ИИ» для статьи — как в toolsai (useHdChat.discussPage). */
export function discussQuestion(title: string): string {
  return `Перескажи статью «${title}» и предложи задать по ней вопросы.`
}

/** Вопрос FAQ: якорь, текст вопроса и markdown ответа (до следующего `##`). */
export interface FaqItem { id: string, q: string, answer: string }

/**
 * Страница «Вопросы и ответы» — списком раскрывающихся вопросов (как ::hd-faq в skills-site):
 * каждый `## Вопрос {#id}` — пункт, текст до следующего `##` — ответ. Текст до первого вопроса
 * не теряется: его отдают отдельно (`intro`).
 */
export function faqItemsOf(markdown: string): { intro: string, items: FaqItem[] } {
  const items: FaqItem[] = []
  const intro: string[] = []
  let current: { id: string, q: string, lines: string[] } | null = null
  let fence = false
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const m = fence ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) {
      if (current) items.push({ id: current.id, q: current.q, answer: current.lines.join('\n').trim() })
      const { text, anchor } = headingOf(m[1]!)
      current = { id: anchor, q: text, lines: [] }
    } else if (current) current.lines.push(line)
    else intro.push(line)
  }
  if (current) items.push({ id: current.id, q: current.q, answer: current.lines.join('\n').trim() })
  return { intro: intro.join('\n').trim(), items }
}
