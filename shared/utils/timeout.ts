// Ожидание с пределом — одно на клиент и сервер (было две копии: server/utils/installerCall.ts и
// app/utils/concurrency.ts — находка /code-review по PR #26).

/** Отказ по истечении срока — отличим от прочих ошибок (`instanceof`), чтобы показать «не ответил». */
export class TimeoutError extends Error {}

/**
 * `promise` или отказ `TimeoutError` через `ms` миллисекунд; исходный промис не отменяется (его
 * результат придёт, но уже не сюда). Таймер снимается в любом исходе и не держит процесс Node.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = `timed out after ${ms} ms`): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms)
    ;(timer as { unref?: () => void }).unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
