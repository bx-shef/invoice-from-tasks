import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildIndex, chunkPage, guidePages, headingOf, isPublicGuideFile, kbSources, kbSystemPrompt, parseGuidePage, parseKbMessages, selectChunks, KB_HISTORY } from '#shared/domain/kb'

const GUIDE = join(__dirname, '..', 'docs', 'guide')
const files = readdirSync(GUIDE).map(name => ({ name, md: readFileSync(join(GUIDE, name), 'utf8') }))
const pages = guidePages(files)
const index = buildIndex(pages.flatMap(chunkPage))

describe('страницы справки', () => {
  it('только NN-имя.md; README каталога — не страница', () => {
    expect(isPublicGuideFile('02-fill.md')).toBe(true)
    expect(isPublicGuideFile('README.md')).toBe(false)
    expect(isPublicGuideFile('../ARCHITECTURE.md')).toBe(false)
    expect(pages.map(p => p.slug)).not.toContain('README')
  })

  it('заголовок, описание, текст без штампа', () => {
    const p = parseGuidePage('05-x.md', '# Заголовок\n\n> Last reviewed: 2026-10-06\n\nОписание.\n\n## Раздел\n\nТекст')!
    expect(p).toEqual({ slug: '05-x', title: 'Заголовок', description: 'Описание.', markdown: '## Раздел\n\nТекст' })
  })

  it('у каждой страницы — заголовок, описание и штамп', () => {
    for (const f of files.filter(f => isPublicGuideFile(f.name))) {
      expect(f.md, f.name).toMatch(/^# .+\n\n> Last reviewed: \d{4}-\d{2}-\d{2}\n\n\S/)
    }
  })

  it('публичная справка не ссылается на внутренние документы', () => {
    for (const f of files) expect(f.md, f.name).not.toMatch(/\]\((\.\.\/|\/docs\/|[A-Z_]+\.md)/)
  })
})

describe('якоря FAQ', () => {
  it('явный {#id} важнее вычисленного', () => {
    expect(headingOf('Почему счёт не заполнился? {#fill-stopped}')).toEqual({ text: 'Почему счёт не заполнился?', anchor: 'fill-stopped' })
    expect(headingOf('Цена строки')).toEqual({ text: 'Цена строки', anchor: 'цена-строки' })
  })

  it('каждая ссылка «Что это значит?» в коде ведёт на существующий вопрос FAQ', () => {
    const faq = pages.find(p => p.slug === '90-faq')!
    const anchors = new Set(chunkPage(faq).map(c => c.url.split('#')[1]))
    const used = new Set<string>()
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name.endsWith('.vue')) for (const m of readFileSync(full, 'utf8').matchAll(/<HelpLink[^>]*anchor="([^"]+)"/g)) used.add(m[1]!)
      }
    }
    walk(join(__dirname, '..', 'app'))
    expect(used.size).toBeGreaterThan(0)
    for (const a of used) expect(anchors.has(a), a).toBe(true)
  })
})

describe('поиск по справке (оценка как в toolsai: нужная страница попадает в контекст)', () => {
  const cases: Array<[string, string]> = [
    ['почему счёт не заполнился', '90-faq'],
    ['как ответить клиенту на комментарий', '90-faq'],
    ['чья ставка берётся для записи времени', '03-rates'],
    ['как вставить qr код в документ', '04-public'],
    ['чем отличается заменить от добавить', '02-fill'],
    ['наценка по тегу задачи', '03-rates']
  ]
  it.each(cases)('«%s» → %s', (q, slug) => {
    expect(selectChunks(index, q).map(c => c.url.split('#')[0])).toContain(slug)
  })

  it('обсуждаемая страница идёт первой; бюджет соблюдается', () => {
    const chosen = selectChunks(index, 'ставка', '04-public')
    expect(chosen[0]!.url.startsWith('04-public')).toBe(true)
    expect(chosen.reduce((n, c) => n + c.text.length, 0)).toBeLessThanOrEqual(24_000)
  })

  it('промпт: только справка, ссылки на /help; источники без повторов', () => {
    const chosen = selectChunks(index, 'код доступа')
    const prompt = kbSystemPrompt(chosen)
    expect(prompt).toMatch(/только публичную справку/)
    expect(prompt).toMatch(/URL: \/help\?p=/)
    const sources = kbSources(chosen, pages)
    expect(new Set(sources.map(s => s.url)).size).toBe(sources.length)
  })
})

describe('история чата', () => {
  it('только user/assistant, последнее — вопрос, не длиннее KB_HISTORY', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }))
    expect(parseKbMessages(many)).toHaveLength(KB_HISTORY)
    expect(parseKbMessages([{ role: 'system', content: 'x' }])).toBeNull()
    expect(parseKbMessages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])).toBeNull()
    expect(parseKbMessages([{ role: 'user', content: 'x'.repeat(5000) }])![0]!.content).toHaveLength(2000)
    expect(parseKbMessages('x')).toBeNull()
  })
})
