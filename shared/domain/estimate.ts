// Оценка часов для задач без затраченного времени (планирование и согласование с клиентом,
// решение владельца 2026-10-07): BitrixGPT по названию и описанию задачи. Оценка — как для
// опытного разработчика с хорошим ИИ-агентом для кода: реалистично, без завышений и «запаса».

import type { ChatMessage } from './prompts'

/** Задач за запрос и пределы текста — бюджет модели. */
export const MAX_ESTIMATE_ITEMS = 25
export const MAX_ESTIMATE_TITLE = 300
export const MAX_ESTIMATE_TEXT = 1500
/** Потолок оценки одной задачи, часов: больше — это уже не задача, а проект. */
export const MAX_ESTIMATE_HOURS = 200

export interface EstimateItem {
  /** `t<ID задачи>`. */
  key: string
  title: string
  description: string
  /** Цена часа ответственного без НДС — для понимания масштаба, не для подгонки суммы. */
  hourPrice: number
}

export const ESTIMATE_SYSTEM_PROMPT = [
  'Ты оцениваешь трудоёмкость задач по разработке и настройке Битрикс24 в часах.',
  'Исполнитель — опытный разработчик, который работает с очень хорошим ИИ-агентом для программирования: рутинный код, вёрстку, типовые интеграции и тесты агент пишет быстро, человек ставит задачу, проверяет и доводит.',
  'Оценивай реалистично и коротко: без завышений, без «запаса на риски» и без округления вверх до круглых чисел. Если задача мелкая — так и оценивай (0.25–1 ч). Цена часа дана только для понимания масштаба, сумму под неё не подгоняй.',
  'Если описание пустое или непонятное — оцени по названию минимально разумно.',
  'Ответ — только JSON: {"estimates":[{"key":"t123","hours":1.5}]}, по одному элементу на каждую задачу из запроса, hours — число часов с шагом 0.25.'
].join('\n')

function cut(text: string, max: number): string {
  const flat = String(text ?? '').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** Сообщения запроса оценки. */
export function buildEstimateMessages(items: EstimateItem[]): ChatMessage[] {
  const payload = items.slice(0, MAX_ESTIMATE_ITEMS).map(i => ({
    key: i.key,
    title: cut(i.title, MAX_ESTIMATE_TITLE),
    description: cut(i.description, MAX_ESTIMATE_TEXT),
    hourPrice: i.hourPrice
  }))
  return [
    { role: 'system', content: ESTIMATE_SYSTEM_PROMPT },
    { role: 'user', content: `Задачи (JSON):\n${JSON.stringify(payload)}` }
  ]
}

/** Часы из ответа модели: только известные ключи, число > 0, шаг 0,25, не больше потолка. */
export function pickEstimates(answer: unknown, keys: readonly string[]): Record<string, number> {
  const list = (answer as { estimates?: unknown } | null)?.estimates
  const out: Record<string, number> = {}
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue
    const { key, hours } = item as { key?: unknown, hours?: unknown }
    const h = Number(hours)
    if (typeof key !== 'string' || !keys.includes(key) || !Number.isFinite(h) || h <= 0) continue
    out[key] = Math.min(Math.round(h * 4) / 4 || 0.25, MAX_ESTIMATE_HOURS)
  }
  return out
}

/** Разбор запроса к /api/ai/estimate: до MAX_ESTIMATE_ITEMS задач, ключи `t<ID>`. */
export function parseEstimateItems(body: unknown): EstimateItem[] | null {
  const items = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(items) || !items.length || items.length > MAX_ESTIMATE_ITEMS) return null
  const out: EstimateItem[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    if (typeof o.key !== 'string' || !/^t\d{1,10}$/.test(o.key) || typeof o.title !== 'string') return null
    out.push({
      key: o.key,
      title: cut(o.title, MAX_ESTIMATE_TITLE),
      description: typeof o.description === 'string' ? cut(o.description, MAX_ESTIMATE_TEXT) : '',
      hourPrice: Number.isFinite(Number(o.hourPrice)) ? Math.max(0, Number(o.hourPrice)) : 0
    })
  }
  return out
}
