// REST от имени администратора-установщика (сохранённые токены). Две ловушки (находка /code-review):
//  1) запись о портале, которую несёт проверенный фрейм-пользователь, взята из кэша проверки и
//     живёт минуту — после рефреша там СТАРЫЕ токены, а refresh-токен одноразовый (ротация):
//     второе сохранение ставок за минуту упало бы на invalid_grant. Поэтому каждый вызов
//     читает запись о портале заново;
//  2) два одновременных вызова с просроченным access-токеном оба пошли бы рефрешить одним и тем же
//     refresh-токеном — выиграл бы один. Поэтому вызовы одного портала выполняются по очереди.
// Очередь — в памяти процесса: сервер один (docs/ARCHITECTURE.md).

import type { RestCall } from './b24Client'
import { getPortal, type KeyValue, type PortalRecord } from './tokenStore'

const queues = new Map<string, Promise<void>>()

/** Выполняет `fn` после всех ранее начатых вызовов с тем же ключом; ошибка не блокирует очередь. */
export function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const run = prev.then(fn)
  const tail = run.then(() => undefined, () => undefined)
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return run
}

export interface InstallerDeps {
  kv: KeyValue
  memberId: string
  /** Клиент REST по записи о портале: токены, их сохранение после рефреша (b24Client.makePortalCall). */
  clientFor: (record: PortalRecord) => RestCall
}

/**
 * `RestCall` токеном установщика: каждый вызов — по свежей записи о портале и в очереди портала.
 * Портала уже нет (удалили приложение) — исключение.
 */
export function makeInstallerCall(deps: InstallerDeps): RestCall {
  return (method, params) => withKeyLock(`installer:${deps.memberId.toLowerCase()}`, async () => {
    const record = await getPortal(deps.kv, deps.memberId)
    if (!record) throw new Error('portal not installed')
    return deps.clientFor(record)(method, params)
  })
}
