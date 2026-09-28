import { describe, expect, it, vi } from 'vitest'
import { chunk, mapLimit, withTimeout } from '~/utils/concurrency'

describe('chunk', () => {
  it('режет на куски не длиннее size; хвост короче', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([1, 2], 2)).toEqual([[1, 2]])
    expect(chunk([], 3)).toEqual([])
  })

  it('размер меньше 1 — ошибка, а не бесконечный цикл; размер 1 — по одному', () => {
    expect(() => chunk([1], 0)).toThrow()
    expect(chunk([1, 2], 1)).toEqual([[1], [2]])
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

  it('после первой ошибки новые вызовы не начинаются', async () => {
    const started: number[] = []
    await expect(mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async (n) => {
      started.push(n)
      await new Promise(r => setTimeout(r, 1))
      if (n === 1) throw new Error('boom')
      return n
    })).rejects.toThrow('boom')
    await new Promise(r => setTimeout(r, 20))
    // Уже запущенные (0–3) доработали, но за ними ничего нового не стартовало.
    expect(started.length).toBeLessThanOrEqual(4 + 3)
    expect(started.length).toBeLessThan(20)
  })

  it('limit меньше 1 — работает как 1, а не молча пропускает всё', async () => {
    expect(await mapLimit([1, 2, 3], 0, async n => n * 2)).toEqual([2, 4, 6])
  })
})

describe('withTimeout — не ждать вечно', () => {
  it('успел — его результат; не успел — отказ с текстом; ошибка исходного — она же', async () => {
    vi.useFakeTimers()
    try {
      await expect(withTimeout(Promise.resolve(7), 100, 'долго')).resolves.toBe(7)
      const slow = withTimeout(new Promise(() => {}), 100, 'справочник не ответил')
      vi.advanceTimersByTime(100)
      await expect(slow).rejects.toThrow('справочник не ответил')
      await expect(withTimeout(Promise.reject(new Error('отказ')), 100, 'долго')).rejects.toThrow('отказ')
    } finally {
      vi.useRealTimers()
    }
  })

  it('до срока не отказывает', async () => {
    vi.useFakeTimers()
    try {
      let settled = false
      withTimeout(new Promise(() => {}), 100, 'долго').catch(() => {
        settled = true
      })
      vi.advanceTimersByTime(99)
      await Promise.resolve()
      expect(settled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
