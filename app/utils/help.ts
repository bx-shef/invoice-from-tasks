// Справка в слайдере (как в client-bank-alfa-by: HelpLink → openSliderAppPage): якорь вопроса едет
// в параметре `place` = `app-help-<якорь>` — хэш до фрейма не доходит. Портал открывает главную
// страницу приложения, она по `place` переходит на /help. Чистые функции для app.vue и HelpLink.

import MarkdownIt from 'markdown-it'
import { headingOf } from '#shared/domain/kb'

export const HELP_PLACE_PREFIX = 'app-help-'
/** Ширина слайдера справки: ниже 640 px портал отдаёт мобильную вёрстку. */
export const HELP_SLIDER_WIDTH = 720

const ANCHOR_RE = /^[a-z0-9-]{1,64}$/

/** `place` для слайдера справки; якорь не по формату — справка без раздела. */
export function helpPlace(anchor: string): string {
  return ANCHOR_RE.test(anchor) ? `${HELP_PLACE_PREFIX}${anchor}` : `${HELP_PLACE_PREFIX.slice(0, -1)}`
}

/** `place` из PLACEMENT_OPTIONS (объект или JSON-строка, ключ `place`/`PLACE`). */
export function placeFromOptions(options: unknown): string {
  let o: unknown = options
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o)
    } catch {
      return ''
    }
  }
  if (!o || typeof o !== 'object') return ''
  const v = (o as Record<string, unknown>).place ?? (o as Record<string, unknown>).PLACE
  return typeof v === 'string' ? v : ''
}

/**
 * Куда перейти по `place`: справка (FAQ) — `{ path: '/help', query: { p: '90-faq' }, hash }`;
 * чужое — `null`. `place` приходит извне — сверяем с форматом, а не подставляем как есть.
 */
export function helpRouteForPlace(place: string): { path: string, query: { p: string }, hash: string } | null {
  if (place === 'app-help') return { path: '/help', query: { p: '01-start' }, hash: '' }
  if (!place.startsWith(HELP_PLACE_PREFIX)) return null
  const anchor = place.slice(HELP_PLACE_PREFIX.length)
  return ANCHOR_RE.test(anchor) ? { path: '/help', query: { p: FAQ_SLUG }, hash: `#${anchor}` } : null
}

/** Страница FAQ: на её якоря ведут подсказки «Что это значит?». */
export const FAQ_SLUG = '90-faq'

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })
// Якоря заголовков — как у поиска справки (headingOf): явный `{#id}` FAQ или вычисленный.
md.core.ruler.push('help_anchors', (state) => {
  const t = state.tokens
  for (let i = 0; i < t.length; i++) {
    if (t[i]!.type !== 'heading_open') continue
    const inline = t[i + 1]
    if (!inline || inline.type !== 'inline') continue
    const { text, anchor } = headingOf(inline.content)
    t[i]!.attrSet('id', anchor)
    t[i]!.attrJoin('class', 'scroll-mt-4')
    inline.content = text
    if (inline.children) {
      const last = inline.children[inline.children.length - 1]
      if (last && last.type === 'text') last.content = last.content.replace(/\s*\{#[a-z0-9-]+\}\s*$/, '')
    }
  }
})

/** Markdown справки → HTML (сырой HTML выключен: текст — из нашего репозитория, но без лазеек). */
export function renderHelp(markdown: string): string {
  return md.render(markdown)
}
