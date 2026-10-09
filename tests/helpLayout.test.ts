import { describe, expect, it } from 'vitest'
import { discussQuestion, faqItemsOf, helpHref, previewOf, searchHelp, searchSectionsOf, surroundOf, tocOf } from '~/utils/helpLayout'
import { renderHelp } from '~/utils/help'

const md = [
  'Вводный текст про ставки.',
  '',
  '## Откуда берутся задачи',
  'Задачи из сделки.',
  '### Привязка к счёту',
  'Текст про привязку.',
  '```',
  '## не заголовок',
  '```',
  '## Что значит «стоп» {#fill-stopped}',
  'Ничего не пишем в счёт.'
].join('\n')

describe('оглавление справки', () => {
  it('h2 и h3 с якорями как у renderHelp; заголовок в блоке кода пропускаем', () => {
    const toc = tocOf(md)
    expect(toc.map(l => [l.depth, l.text])).toEqual([
      [2, 'Откуда берутся задачи'],
      [3, 'Привязка к счёту'],
      [2, 'Что значит «стоп»']
    ])
    expect(toc[2]!.id).toBe('fill-stopped')
    const html = renderHelp(md)
    for (const l of toc) expect(html).toContain(`id="${l.id}"`)
  })

  it('«В статье:» — только h2, не больше восьми', () => {
    expect(previewOf(tocOf(md)).map(l => l.depth)).toEqual([2, 2])
    const many = Array.from({ length: 10 }, (_, i) => `## Раздел ${i}`).join('\n')
    expect(previewOf(tocOf(many))).toHaveLength(8)
  })
})

describe('поиск по справке', () => {
  const pages = [
    { slug: '01-start', title: 'Начало', description: 'Как начать', markdown: md },
    { slug: '90-faq', title: 'Вопросы', description: '', markdown: '## Ёлка и ставки {#tree}\nПро ёлку.' }
  ]
  const sections = searchSectionsOf(pages)

  it('разделы: начало страницы и каждый заголовок, текст — к своему разделу', () => {
    expect(sections.map(s => `${s.slug}#${s.anchor}`)).toEqual([
      '01-start#', '01-start#откуда-берутся-задачи', '01-start#привязка-к-счёту', '01-start#fill-stopped', '90-faq#', '90-faq#tree'
    ])
    expect(sections[0]!.text).toContain('Вводный текст')
    expect(sections[2]!.crumb).toBe('Начало')
    expect(sections[2]!.text).toContain('привязку')
    expect(sections[2]!.text).not.toContain('не заголовок')
  })

  it('все слова обязательны; заголовок весит больше текста; ё = е', () => {
    expect(searchHelp(sections, 'с')).toEqual([])
    expect(searchHelp(sections, 'задачи нетслова')).toEqual([])
    const hits = searchHelp(sections, 'ставки')
    expect(hits[0]).toMatchObject({ slug: '90-faq', anchor: 'tree', score: 3 })
    expect(hits.map(h => h.anchor)).toContain('')
    expect(searchHelp(sections, 'елка')[0]!.anchor).toBe('tree')
    expect(searchHelp(sections, 'а', 1)).toEqual([])
    expect(searchHelp(sections, 'ст', 2)).toHaveLength(2)
  })
})

describe('навигация справки', () => {
  const pages = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }]
  it('соседи: у первой нет предыдущей, у последней — следующей, чужая — ничего', () => {
    expect(surroundOf(pages, 'a')).toEqual([null, { slug: 'b' }])
    expect(surroundOf(pages, 'b')).toEqual([{ slug: 'a' }, { slug: 'c' }])
    expect(surroundOf(pages, 'c')).toEqual([{ slug: 'b' }, null])
    expect(surroundOf(pages, 'x')).toEqual([null, null])
  })

  it('адрес раздела и вопрос «Обсудить с ИИ»', () => {
    expect(helpHref('90-faq', 'approval-answer')).toBe('/help?p=90-faq#approval-answer')
    expect(helpHref('02-fill')).toBe('/help?p=02-fill')
    expect(discussQuestion('Заполнение')).toBe('Перескажи статью «Заполнение» и предложи задать по ней вопросы.')
  })
})

describe('faqItemsOf', () => {
  it('режет FAQ на вопросы с якорями, вступление отдельно, ## в коде — не вопрос', () => {
    const md = 'Вступление.\n\n## Почему? {#why}\n\nПотому.\n\n```\n## не вопрос\n```\n\n## Как {#how}\nТак.'
    expect(faqItemsOf(md)).toEqual({
      intro: 'Вступление.',
      items: [
        { id: 'why', q: 'Почему?', answer: 'Потому.\n\n```\n## не вопрос\n```' },
        { id: 'how', q: 'Как', answer: 'Так.' }
      ]
    })
  })
})
