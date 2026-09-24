// Сценарий счёта на живом портале: чтение теми же запросами, что страница, расчёт чистыми
// функциями приложения во всех сочетаниях настроек, запись «заменить»/«добавить», пакет с
// ошибкой посередине, дело консультации. Ожидания — независимой таблицей, а не вызовом тех же
// функций: иначе проверка повторяла бы ошибку кода.

import { beforeAll, describe, expect, inject, it } from 'vitest'
import { buildConsultActivity, DESCRIPTION_TYPE_BB } from '#shared/domain/activity'
import { currencyConversion, parseCurrencies, type CurrencyConversion, type PortalCurrency } from '#shared/domain/currency'
import { buildRows, rowsTotal, toProductRows, type FillMode, type TaskSource } from '#shared/domain/fill'
import { invoiceProblems, type InvoiceInfo } from '#shared/domain/invoice'
import { normalizeTag, type MarkupSettings } from '#shared/domain/markup'
import type { RateEntry } from '#shared/domain/rates'
import { defaultSettings, type AppSettings } from '#shared/domain/settings'
import type { TaskInfo, TimeEntry } from '#shared/domain/tasks'
import type { RoundingDirection, RoundingStep } from '#shared/domain/time'
import { addRowCall, replaceRowsCall } from '~/utils/invoiceRequests'
import { describeWrite } from '~/utils/writeOutcome'
import { connectPortal, type Portal } from './lib/portal'
import { fetchEntries, fetchTasks, readInvoice } from './lib/flow'

const env = inject('smokeEnv')
const fx = inject('fixture')

/** Ставки сотрудника вебхука: 100 до 01.09, 150 с 01.09 — запись задним числом попадает на 100. */
const ratesFor = (userId: number): RateEntry[] => [{ userId, rate: 100, from: '2026-01-01' }, { userId, rate: 150, from: '2026-09-01' }]

const MARKUPS: Record<'none' | 'tags', MarkupSettings> = {
  none: { defaultPercent: 0, tags: [] },
  // «дизайн» выше «Срочно»: у задачи дизайна оба тега — сработать должно первое правило.
  tags: { defaultPercent: 70, tags: [{ tag: 'дизайн', percent: 100 }, { tag: '#Срочно', percent: 50 }, { tag: 'ЧЧ1', percent: 20 }] }
}

/** Ожидаемая наценка задачи — таблицей, по тегам из засева (smoke/lib/seed.ts). */
function expectedMarkup(kind: keyof typeof MARKUPS, task: 'design' | 'plain' | 'invoiceSi' | 'invoiceT1f'): number {
  if (kind === 'none') return 0
  return { design: 100, plain: 70, invoiceSi: 20, invoiceT1f: 70 }[task]
}

function expectedSeconds(seconds: number, step: RoundingStep, direction: RoundingDirection): number {
  if (step === 0) return seconds
  const s = step * 60
  return (direction === 'nearest' ? Math.round(seconds / s) : Math.ceil(seconds / s)) * s
}

const SOURCES = [
  { name: 'сделка → счёт в другой валюте', invoice: 'usd', source: 'deal' },
  { name: 'сделка → счёт в валюте ставок', invoice: 'base', source: 'deal' },
  { name: 'задачи счёта (SI_ и T1f_)', invoice: 'noDeal', source: 'invoice' }
] as const
const MODES: FillMode[] = ['task', 'time']
const ROUNDINGS: Array<[RoundingStep, RoundingDirection]> = [[0, 'up'], [30, 'up'], [60, 'nearest']]
const MARKUP_KINDS = ['none', 'tags'] as const

const VARIANTS = SOURCES.flatMap(src => MODES.flatMap(mode => ROUNDINGS.flatMap(([step, direction]) => MARKUP_KINDS.map(markup => ({
  label: `${src.name} · тип ${mode === 'task' ? 1 : 2} · округление ${step ? `${step} мин ${direction === 'up' ? 'вверх' : 'к ближайшему'}` : 'нет'} · наценка ${markup === 'tags' ? 'по тегам' : 'нет'}`,
  src, mode, step, direction, markup
})))))

describe.skipIf(!env || !fx)('счёт из задач на живом портале', () => {
  let portal: Portal
  let currencies: PortalCurrency[]
  const invoices = new Map<string, InvoiceInfo>()
  const tasksBySource = new Map<TaskSource, TaskInfo[]>()
  const entries: TimeEntry[] = []
  const nameOf = new Map<number, 'design' | 'plain' | 'invoiceSi' | 'invoiceT1f'>()

  function settingsFor(v: typeof VARIANTS[number]): AppSettings {
    return { ...defaultSettings(), currency: fx!.baseCurrency, rounding: v.step, roundingDirection: v.direction, markup: MARKUPS[v.markup], measureCode: 796 }
  }

  beforeAll(async () => {
    portal = connectPortal(env!.hook)
    currencies = parseCurrencies(await portal.call('crm.currency.list', {}))
    for (const key of ['usd', 'base', 'noDeal'] as const) invoices.set(key, (await readInvoice(portal, fx!.invoices[key])).invoice)
    tasksBySource.set('deal', await fetchTasks(portal, 'deal', invoices.get('usd')!))
    tasksBySource.set('invoice', await fetchTasks(portal, 'invoice', invoices.get('noDeal')!))
    for (const t of [...tasksBySource.get('deal')!, ...tasksBySource.get('invoice')!]) entries.push(...(await fetchEntries(portal, t.id)).entries)
    for (const [name, id] of Object.entries(fx!.tasks)) if (name !== 'foreign' && name !== 'paging') nameOf.set(id, name as 'design')
  })

  it('задачи находятся по обоим источникам, чужая — нет; теги пришли из списка', () => {
    expect(tasksBySource.get('deal')!.map(t => t.id).sort()).toEqual([fx!.tasks.design, fx!.tasks.plain].sort())
    expect(tasksBySource.get('invoice')!.map(t => t.id).sort()).toEqual([fx!.tasks.invoiceSi, fx!.tasks.invoiceT1f].sort())
    // Регистр тега задаёт портал (тег — общая запись портала), поэтому сравнение — как в markup.ts.
    expect(tasksBySource.get('deal')!.find(t => t.id === fx!.tasks.design)?.tags.map(normalizeTag).sort()).toEqual(['дизайн', 'срочно'])
    expect(entries).toHaveLength(fx!.entries.length)
  })

  it.each(VARIANTS)('$label', (v) => {
    const invoice = invoices.get(v.src.invoice)!
    const settings = settingsFor(v)
    expect(invoiceProblems(invoice, settings, v.src.source)).toEqual([])
    const conv = currencyConversion(settings.currency, invoice.currencyId, currencies)
    if (!conv.ok) throw new Error(conv.problem)
    const conversion: CurrencyConversion | null = conv.conversion
    expect(conversion === null).toBe(invoice.currencyId === fx!.baseCurrency)
    const tasks = tasksBySource.get(v.src.source)!
    const built = buildRows({ mode: v.mode, tasks, entries, rates: ratesFor(fx!.userId), settings, conversion })
    const factor = conversion?.factor ?? 1

    // Каждая строка — по независимой формуле.
    for (const row of built.rows) {
      const task = nameOf.get(row.taskId)!
      const own = entries.filter(e => e.taskId === row.taskId && e.seconds > 0)
      const seconds = v.mode === 'task' ? own.reduce((s, e) => s + e.seconds, 0) : own.find(e => e.id === row.entryId)!.seconds
      const date = v.mode === 'task' ? own.map(e => e.date!).sort().at(-1)! : own.find(e => e.id === row.entryId)!.date!
      const base = date < '2026-09-01' ? 100 : 150
      const percent = expectedMarkup(v.markup, task)
      expect(row).toMatchObject({ seconds, rateDate: date, baseRate: base, markupPercent: percent })
      expect(row.roundedSeconds).toBe(expectedSeconds(seconds, v.step, v.direction))
      expect(row.quantity).toBe(Math.round(row.roundedSeconds / 3600 * 10_000) / 10_000)
      expect(row.price).toBe(Math.round(base * factor * (100 + percent)) / 100)
      expect(row.sum).toBe(Math.round(row.price * row.quantity * 100) / 100)
    }

    // Строки, ошибки и предупреждения — по таблице засева.
    const shortZero = v.mode === 'time' && v.src.source === 'deal' && v.step === 60 && v.direction === 'nearest'
    const expectedRows = v.src.source === 'deal' ? (v.mode === 'task' ? 2 : shortZero ? 3 : 4) : (v.mode === 'task' ? 2 : 1)
    expect(built.rows).toHaveLength(expectedRows)
    const emptyComment = v.mode === 'time' && v.src.source === 'invoice'
    expect(built.errors.map(e => e.taskId)).toEqual(emptyComment ? [fx!.tasks.invoiceT1f] : [])
    const warnings = built.warnings.map(w => w.message)
    expect(warnings.some(w => w.startsWith('Цены пересчитаны'))).toBe(conversion !== null)
    if (conversion) expect(warnings[0]).toContain('проверьте курс')
    expect(warnings.some(w => w.includes('менялась за время задачи'))).toBe(v.mode === 'task' && v.src.source === 'deal')
    expect(warnings.some(w => w.includes('после округления стало нулём'))).toBe(shortZero)
  })

  it('источник «сделка» у счёта без сделки — остановка до чтения задач', () => {
    expect(invoiceProblems(invoices.get('noDeal')!, { ...defaultSettings(), currency: fx!.baseCurrency }, 'deal'))
      .toEqual(['Счёт не связан со сделкой — выберите задачи, привязанные к самому счёту'])
  })

  it('валюта без курса в портале — остановка с понятной причиной', () => {
    const missing = ['JPY', 'CNY', 'CHF', 'GBP'].find(code => !currencies.some(c => c.code === code))!
    const res = currencyConversion(fx!.baseCurrency, missing, currencies)
    expect(res).toMatchObject({ ok: false, problem: expect.stringContaining(`нет курса ${missing}`) })
  })

  it('нет ставки на дату — ошибка по каждой задаче, строк нет', () => {
    const built = buildRows({ mode: 'task', tasks: tasksBySource.get('deal')!, entries, rates: [], settings: { ...defaultSettings(), currency: fx!.baseCurrency } })
    expect(built.rows).toEqual([])
    expect(built.errors.map(e => e.message)).toEqual([expect.stringContaining('нет ставки'), expect.stringContaining('нет ставки')])
  })

  describe('запись в счёт (последовательно)', () => {
    const variant = VARIANTS.find(v => v.src.invoice === 'usd' && v.mode === 'task' && v.step === 30 && v.markup === 'tags')!

    it('«Заменить»: позиции = строки предпросмотра, сумму счёта портал считает так же', async () => {
      const settings = settingsFor(variant)
      const conv = currencyConversion(settings.currency, invoices.get('usd')!.currencyId, currencies)
      const built = buildRows({ mode: 'task', tasks: tasksBySource.get('deal')!, entries, rates: ratesFor(fx!.userId), settings, conversion: conv.ok ? conv.conversion : null })
      const { method, params } = replaceRowsCall(fx!.invoices.usd, toProductRows(built.rows, settings))
      await portal.call(method, params)
      const after = await readInvoice(portal, fx!.invoices.usd)
      expect(after.rows.map(r => [r.productName, r.price, r.quantity])).toEqual(built.rows.map(r => [r.name, r.price, r.quantity]))
      expect(after.invoice.opportunity).toBeCloseTo(rowsTotal(built.rows), 2)
      expect(describeWrite({ mode: 'replace', planned: built.rows.length, before: 0, after: after.rows.length, error: null }).kind).toBe('done')
    })

    it('«Добавить»: строки после существующих, сортировка продолжается', async () => {
      const settings = { ...settingsFor(variant), rounding: 0 as const }
      const before = await readInvoice(portal, fx!.invoices.usd)
      const conv = currencyConversion(settings.currency, before.invoice.currencyId, currencies)
      const built = buildRows({ mode: 'time', tasks: tasksBySource.get('deal')!, entries, rates: ratesFor(fx!.userId), settings, conversion: conv.ok ? conv.conversion : null })
      const sortStart = before.rows.reduce((m, r) => Math.max(m, r.sort), 0)
      const calls = toProductRows(built.rows, settings, sortStart).map((f): [string, Record<string, unknown>] => {
        const { method, params } = addRowCall(fx!.invoices.usd, f)
        return [method, params as Record<string, unknown>]
      })
      const res = await portal.batch(calls, true)
      expect(res.ok).toBe(true)
      const after = await readInvoice(portal, fx!.invoices.usd)
      expect(after.rows).toHaveLength(before.rows.length + built.rows.length)
      expect(Math.min(...after.rows.slice(before.rows.length).map(r => r.sort))).toBeGreaterThan(sortStart)
      expect(describeWrite({ mode: 'append', planned: built.rows.length, before: before.rows.length, after: after.rows.length, error: null }).kind).toBe('done')
    })

    it('«Добавить» с ошибкой посередине: портал останавливается, итог — «добавлено 1 из 3»', async () => {
      const before = await readInvoice(portal, fx!.invoices.base)
      const row = { productName: `${fx!.runTag}: строка пакета`, price: 1, quantity: 1, sort: 10 }
      const res = await portal.batch([
        ['crm.item.productrow.add', addRowCall(fx!.invoices.base, row).params],
        ['crm.item.productrow.add', addRowCall(999_999_999, row).params],
        ['crm.item.productrow.add', addRowCall(fx!.invoices.base, { ...row, sort: 20 }).params]
      ], true)
      expect(res.ok).toBe(false)
      expect(res.answers.map(a => a.ok)).toEqual([true, false])
      const after = await readInvoice(portal, fx!.invoices.base)
      expect(after.rows).toHaveLength(before.rows.length + 1)
      const verdict = describeWrite({ mode: 'append', planned: 3, before: before.rows.length, after: after.rows.length, error: res.errors.join('; ') })
      expect(verdict).toMatchObject({ kind: 'error', resetPreview: true })
      expect(verdict.message).toContain('добавлено 1 из 3')
    })

    it('дело консультации: создаётся в счёте, разметка обезврежена, DESCRIPTION_TYPE = 3', async () => {
      const res = await portal.call<{ id?: unknown } | number>('crm.activity.todo.add', buildConsultActivity({
        invoiceId: fx!.invoices.usd, promptTitle: `Смок [b]${fx!.runTag}[/b]`, answer: 'Строка 1\nСтрока 2 <b>html</b>', responsibleId: fx!.userId, nowMs: Date.now()
      }))
      const id = typeof res === 'number' ? res : Number(res?.id)
      expect(id).toBeGreaterThan(0)
      await portal.call('crm.activity.update', { id, fields: { DESCRIPTION_TYPE: DESCRIPTION_TYPE_BB } })
      const activity = await portal.call<Record<string, unknown>>('crm.activity.get', { id })
      expect(activity).toMatchObject({ OWNER_TYPE_ID: '31', OWNER_ID: String(fx!.invoices.usd), DESCRIPTION_TYPE: '3' })
      expect(String(activity.SUBJECT)).not.toContain('[b]')
      expect(String(activity.DESCRIPTION)).not.toContain('<b>')
    })
  })
})
