import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TASK_TITLE_PROMPT,
  DEFAULT_TIME_BLOCK_PROMPT,
  MAX_CONSULT_CONTEXT,
  NAMING_FORMAT_RULES,
  buildConsultMessages,
  buildNamingMessages,
  effectiveNamingPrompt,
  pickNames
} from '#shared/domain/prompts'

describe('промпты названий', () => {
  it('пустой свой промпт — действует системный (так работает «восстановить системный»)', () => {
    expect(effectiveNamingPrompt('task', null)).toBe(DEFAULT_TASK_TITLE_PROMPT)
    expect(effectiveNamingPrompt('time', '   ')).toBe(DEFAULT_TIME_BLOCK_PROMPT)
    expect(effectiveNamingPrompt('time', 'Мой')).toBe('Мой')
  })

  it('правило формата ответа добавляется всегда, даже к своему промпту', () => {
    const [system] = buildNamingMessages('task', 'Мой промпт', [])
    expect(system?.content).toContain('Мой промпт')
    expect(system?.content).toContain(NAMING_FORMAT_RULES)
  })

  it('тип 1 передаёт заголовок, описание и отчёт; тип 2 — заголовок задачи и описание записи', () => {
    const t1 = JSON.parse(buildNamingMessages('task', null, [{ key: 't1', title: 'T', text: 'D', result: 'R' }])[1]!.content)
    expect(t1.items[0]).toEqual({ key: 't1', title: 'T', description: 'D', result: 'R' })
    const t2 = JSON.parse(buildNamingMessages('time', null, [{ key: 'e1', title: 'T', text: 'C' }])[1]!.content)
    expect(t2.items[0]).toEqual({ key: 'e1', taskTitle: 'T', text: 'C' })
  })
})

describe('pickNames — разбор ответа модели', () => {
  it('берёт только запрошенные ключи и только непустые строки', () => {
    expect(pickNames({ t1: ' Разработка ', t2: 42, extra: 'лишнее' }, ['t1', 't2'])).toEqual({ t1: 'Разработка' })
    expect(pickNames(['t1'], ['t1'])).toEqual({})
  })
})

describe('консультация', () => {
  it('обрезает слишком большой контекст', () => {
    const [, user] = buildConsultMessages('Оцени', { big: 'x'.repeat(MAX_CONSULT_CONTEXT * 2) })
    expect(user!.content.length).toBeLessThan(MAX_CONSULT_CONTEXT + 200)
    expect(user!.content).toContain('(обрезано)')
  })
})
