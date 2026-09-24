// Связь с порталом из фрейма: инициализация B24Frame (@bitrix24/b24jssdk) и обёртки вызовов.
// Одиночка на уровне модуля — как в эталоне client-bank-alfa-by (app/composables/useB24.ts).
//
// ⚠ Токен фрейма уходит и на НАШ сервер (useApi.ts), а SDK обновляет его только на пути своих
// запросов. Опции `keepAuthFresh` из документации в установленной версии 2.2.0 ещё нет (проверено
// по типам пакета), поэтому свежесть токена перед запросом к серверу обеспечивает useApi.ts.

import { ApiVersion, initializeB24Frame, type AjaxResult, type B24Frame, type Result } from '@bitrix24/b24jssdk'
import { B24CallError, unwrapBatchPart, type BatchCall, type BatchItem } from '~/utils/b24Batch'

let frame: B24Frame | undefined
let inFlight: Promise<B24Frame | undefined> | undefined

/** Максимум команд в одном batch-запросе REST v2 (документация BatchV2.make). */
export const BATCH_MAX = 50

export function useB24() {
  const ready = useState('b24-ready', () => false)

  /**
   * Инициализирует фрейм. `undefined` — страница открыта не в портале (прямая ссылка, превью):
   * у такой страницы нет `window.name` с данными портала, и SDK отказал бы сразу.
   */
  async function init(): Promise<B24Frame | undefined> {
    if (frame) return frame
    if (inFlight) return inFlight
    if (typeof window === 'undefined' || !window.name) return undefined
    inFlight = initializeB24Frame()
      .then((f) => {
        frame = f
        ready.value = true
        return f
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = undefined
      })
    return inFlight
  }

  function get(): B24Frame | undefined {
    return frame
  }

  function getOrThrow(): B24Frame {
    if (!frame) throw new Error('Приложение открыто не в Битрикс24')
    return frame
  }

  /** Один вызов REST v2: результат или {@link B24CallError}. */
  async function call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await getOrThrow().actions.v2.call.make({ method, params })
    if (!res.isSuccess) throw new B24CallError(method, res.getErrorMessages())
    return res.getData()?.result as T
  }

  /** Все страницы списочного метода (курсором по id — рекомендованный Битрикс24 способ). */
  async function callList<T = unknown>(method: string, params: Record<string, unknown>, opts: { idKey?: string, cursorIdKey?: string, customKeyForResult?: string } = {}): Promise<T[]> {
    const res = await getOrThrow().actions.v2.callList.make<T>({ method, params, ...opts })
    if (!res.isSuccess) throw new B24CallError(method, res.getErrorMessages())
    return res.getData() ?? []
  }

  /**
   * Пачка вызовов, порциями по {@link BATCH_MAX}. Возвращает результат каждой команды по порядку;
   * первая же ошибка — исключение с методом и текстом портала (частичный результат нам не нужен).
   *
   * `haltOnError` — портал прекращает выполнять команды пакета после первой ошибки, а следующие
   * порции не отправляются. Нужен для ЗАПИСИ: без него ошибка в середине не мешала бы портале
   * выполнить остальные команды порции (`isHaltOnError: false`).
   */
  async function batch<T = unknown>(calls: BatchCall[], opts: { haltOnError?: boolean } = {}): Promise<T[]> {
    const out: T[] = []
    for (let i = 0; i < calls.length; i += BATCH_MAX) {
      const part = calls.slice(i, i + BATCH_MAX)
      const res = await getOrThrow().actions.v2.batch.make({
        calls: part,
        options: { isHaltOnError: opts.haltOnError ?? false, returnAjaxResult: true }
      }) as Result<AjaxResult<T>[]>
      if (!res.isSuccess) throw new B24CallError('batch', res.getErrorMessages())
      // Ошибка команды или остановка пакета порталом — исключение (b24Batch.ts, покрыт тестом).
      out.push(...unwrapBatchPart((res.getData() ?? []) as unknown as BatchItem<T>[], part))
    }
    return out
  }

  /**
   * Выполняет запись без автоматических повторов SDK. По умолчанию SDK повторяет запрос при
   * сетевой ошибке, таймауте и ответе 5xx (до 3 попыток, retryOnNetworkError — код пакета 2.2.0):
   * запрос, который портал выполнил, но ответил поздно, ушёл бы ещё раз, и для
   * crm.item.productrow.add это молчаливые дубли строк (находка /code-review). Отказы по лимитам
   * портала (429, QUERY_LIMIT_EXCEEDED) SDK по-прежнему пережидает и повторяет: такой запрос
   * портал не выполнял. После записи настройки возвращаются как были.
   */
  async function withoutWriteRetry<T>(fn: () => Promise<T>): Promise<T> {
    const f = getOrThrow()
    const saved = f.getHttpClient(ApiVersion.v2).getRestrictionManagerParams()
    await f.setRestrictionManagerParams({
      ...saved,
      retryOnNetworkError: false,
      // ERR_BAD_RESPONSE — так axios помечает ответ 5xx; без этого кода SDK счёл бы его временным.
      hardErrorCodes: [...(saved.hardErrorCodes ?? []), 'ERR_BAD_RESPONSE']
    })
    try {
      return await fn()
    } finally {
      await f.setRestrictionManagerParams(saved)
    }
  }

  return { ready, init, get, getOrThrow, call, callList, batch, withoutWriteRetry }
}
