import { describe, expect, it } from 'vitest'
import { encodeKbEvent, kbStreamParser } from '../shared/domain/kbStream'

describe('kbStream', () => {
  it('собирает события, порванные между кусками сети', () => {
    const wire = encodeKbEvent({ type: 'sources', sources: [{ title: 'Ставки', url: '/help?p=rates' }] })
      + encodeKbEvent({ type: 'text', text: 'При' }) + encodeKbEvent({ type: 'text', text: 'вет\n' })
    const p = kbStreamParser()
    const got = [...wire.match(/[\s\S]{1,7}/g)!.flatMap(c => p.push(c)), ...p.flush()]
    expect(got).toEqual([
      { type: 'sources', sources: [{ title: 'Ставки', url: '/help?p=rates' }] },
      { type: 'text', text: 'При' },
      { type: 'text', text: 'вет\n' }
    ])
  })

  it('отдаёт хвост без перевода строки на flush и пропускает мусор', () => {
    const p = kbStreamParser()
    expect(p.push('not json\n{"type":"x"}\n{"type":"error","message":"сбой"}')).toEqual([])
    expect(p.flush()).toEqual([{ type: 'error', message: 'сбой' }])
  })
})
