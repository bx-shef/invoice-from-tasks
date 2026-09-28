import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimeoutError, withTimeout } from '#shared/utils/timeout'

describe('withTimeout — не ждать вечно (клиент и сервер)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('успел — его результат, и таймер снят', async () => {
    await expect(withTimeout(Promise.resolve(7), 100, 'долго')).resolves.toBe(7)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('не успел — отказ с текстом, таймер снят', async () => {
    const slow = withTimeout(new Promise(() => {}), 100, 'справочник не ответил')
    vi.advanceTimersByTime(100)
    await expect(slow).rejects.toThrow('справочник не ответил')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ошибка исходного — она же (не TimeoutError), таймер снят', async () => {
    const error = await withTimeout(Promise.reject(new Error('отказ')), 100).catch((e: unknown) => e)
    expect((error as Error).message).toBe('отказ')
    expect(error).not.toBeInstanceOf(TimeoutError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('отказ по сроку — TimeoutError: вызывающий отличает «не ответил» от прочих ошибок', async () => {
    const slow = withTimeout(new Promise(() => {}), 100).catch((e: unknown) => e)
    vi.advanceTimersByTime(100)
    const error = await slow
    expect(error).toBeInstanceOf(TimeoutError)
    expect((error as Error).message).toBe('timed out after 100 ms')
  })

  it('до срока не отказывает', async () => {
    let settled = false
    withTimeout(new Promise(() => {}), 100, 'долго').catch(() => {
      settled = true
    })
    vi.advanceTimersByTime(99)
    await Promise.resolve()
    expect(settled).toBe(false)
  })
})
