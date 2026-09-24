// Готовность REST v3 к задачам приложения (issue #13). Проверки фиксируют СЕГОДНЯШНИЕ ограничения
// v3: пока они верны, приложение законно сидит на v2. Покраснела проверка — Битрикс24 добавил
// возможность, и пора возвращаться к v3 по #13 (правило владельца «v3, где метод есть»).

import { beforeAll, describe, expect, inject, it } from 'vitest'
import { listRows } from '#shared/domain/tasks'
import { connectPortal, type Portal } from './lib/portal'

const env = inject('smokeEnv')
const fx = inject('fixture')
const HINT = 'v3 научился — пора возвращаться к REST v3 по issue #13'

describe.skipIf(!env || !fx)('готовность REST v3 (issue #13)', () => {
  let portal: Portal
  beforeAll(() => {
    portal = connectPortal(env!.hook)
  })

  it('v3 tasks.task.list не фильтрует по привязке к CRM (crmItemIds)', async () => {
    const res = await portal.callV3('tasks.task.list', { select: ['id'], filter: [['crmItemIds', '=', `D_${fx!.dealId}`]] })
      .then(() => 'принят', (e: Error) => e.message)
    expect(res, HINT).toMatch(/Filterable/)
  })

  it('v3 tasks.task.list не отдаёт теги (связанные объекты)', async () => {
    const res = await portal.callV3('tasks.task.list', { select: ['id', 'tags.name'], filter: [['id', '=', fx!.tasks.design]] })
    const [item] = listRows(res, 'items')
    expect(item?.tags, HINT).toBeUndefined()
  })

  it('v3 tasks.task.get не отдаёт записи времени (elapsedTime)', async () => {
    const res = await portal.callV3<{ item?: Record<string, unknown> }>('tasks.task.get', { id: fx!.tasks.design, select: ['id', 'elapsedTime.id', 'elapsedTime.seconds'] })
    expect(res?.item?.elapsedTime, HINT).toBeUndefined()
  })

  it('пакет v3 выполняется целиком или никак: одна несуществующая задача — отказ всего пакета', async () => {
    const res = await portal.batchV3([
      ['tasks.task.get', { id: fx!.tasks.design, select: ['id'] }],
      ['tasks.task.get', { id: 999_999_999, select: ['id'] }]
    ])
    expect(res.ok).toBe(false)
    expect(res.answers).toEqual([])
  })
})
