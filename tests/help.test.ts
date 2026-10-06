import { describe, expect, it } from 'vitest'
import { helpPlace, helpRouteForPlace, placeFromOptions, renderHelp } from '~/utils/help'

describe('слайдер справки', () => {
  it('place: якорь в параметре; кривой якорь — справка без раздела', () => {
    expect(helpPlace('fill-stopped')).toBe('app-help-fill-stopped')
    expect(helpPlace('../x')).toBe('app-help')
  })

  it('маршрут по place: FAQ с якорем; чужое и кривое — null', () => {
    expect(helpRouteForPlace('app-help-fill-stopped')).toEqual({ path: '/help', query: { p: '90-faq' }, hash: '#fill-stopped' })
    expect(helpRouteForPlace('app-help')).toEqual({ path: '/help', query: { p: '01-start' }, hash: '' })
    expect(helpRouteForPlace('app-help-<script>')).toBeNull()
    expect(helpRouteForPlace('app-main')).toBeNull()
    expect(helpRouteForPlace('')).toBeNull()
  })

  it('PLACEMENT_OPTIONS: объект или JSON-строка, place или PLACE', () => {
    expect(placeFromOptions({ place: 'app-help-x' })).toBe('app-help-x')
    expect(placeFromOptions('{"PLACE":"app-help-y"}')).toBe('app-help-y')
    expect(placeFromOptions('не json')).toBe('')
    expect(placeFromOptions(null)).toBe('')
  })
})

describe('markdown справки', () => {
  it('якоря заголовков — как у поиска, {#id} не виден; сырой HTML не проходит', () => {
    const html = renderHelp('## Почему? {#fill-stopped}\n\n## Цена строки\n\n<script>alert(1)</script>')
    expect(html).toContain('<h2 id="fill-stopped" class="scroll-mt-4">Почему?</h2>')
    expect(html).toContain('id="цена-строки"')
    expect(html).not.toContain('<script>')
  })
})
