import { describe, expect, it } from 'vitest'
import { chunk, mapLimit } from '~/utils/concurrency'

describe('chunk', () => {
  it('режет на куски не длиннее size; хвост короче', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([1, 2], 2)).toEqual([[1, 2]])
    expect(chunk([], 3)).toEqual([])
  })

  it('размер меньше 1 — ошибка, а не бесконечный цикл', () => {
    expect(() => chunk([1], 0)).toThrow()
  })
})

describe('mapLimit', () => {
  it('сохраняет порядок входа, даже если ответы приходят вразнобой', async () => {
    const delays = [30, 5, 20, 1]
    const out = await mapLimit(delays, 2, async (ms, i) => {
      await new Promise(r => setTimeout(r, ms))
      return i
    })
    expect(out).toEqual([0, 1, 2, 3])
  })

  it('одновременно работает не больше limit вызовов', async () => {
    let active = 0
    let peak = 0
    await mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 2))
      active--
    })
    expect(peak).toBe(3)
  })

  it('пустой вход — пустой результат; ошибка отклоняет весь вызов', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([])
    await expect(mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    })).rejects.toThrow('boom')
  })
})
