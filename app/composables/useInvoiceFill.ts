// Сценарий страницы счёта: прочитать счёт → найти задачи → прочитать время, ставки, товары →
// собрать строки (shared/domain/fill.ts) → показать → записать. Все чтения и записи в CRM идут
// ПРАВАМИ СОТРУДНИКА через фрейм: видит только свои задачи, пишет только в доступный ему счёт.
// Методы и их поля — docs/REST_METHODS.md.

import { buildConsultActivity, DESCRIPTION_TYPE_BB } from '#shared/domain/activity'
import { applyNames, buildRows, rowsTotal, toProductRows, type FillMode, type FillResult, type ProductInfo, type TaskSource } from '#shared/domain/fill'
import { invoiceProblems, parseExistingRows, parseInvoice, type ExistingRow, type InvoiceInfo } from '#shared/domain/invoice'
import { clipNamingItem, fitConsultContext, MAX_NAMING_ITEMS, type NamingItem } from '#shared/domain/prompts'
import {
  crmBindingCodes,
  DEAL_ENTITY_TYPE_ID,
  INVOICE_ENTITY_TYPE_ID,
  INVOICE_OWNER_TYPE,
  listRows,
  parseTimeEntry,
  tasksBoundTo,
  type TaskInfo,
  type TimeEntry
} from '#shared/domain/tasks'
import { chunk, mapLimit } from '~/utils/concurrency'

/** Поля задачи, которые мы читаем (tasks.task.list, REST v2). */
export const TASK_SELECT = ['ID', 'TITLE', 'DESCRIPTION', 'RESPONSIBLE_ID', 'UF_CRM_TASK', 'TIME_SPENT_IN_LOGS']

/** Страница task.elapseditem.getlist — максимум 50 (документация метода). */
const ELAPSED_PAGE = 50
/** Потолок страниц записей времени одной задачи: 100 × 50 = 5000 записей. */
const MAX_ELAPSED_PAGES = 100
/** Страница crm.item.productrow.list — 50 (документация метода: «Размер страницы — 50 записей»). */
const PRODUCT_ROWS_PAGE = 50
/** Потолок позиций счёта, которые читаем: 200 страниц × 50. */
const MAX_PRODUCT_ROWS = 10_000
/** Глубина обхода папок каталога вверх — страховка от циклов в данных. */
const MAX_SECTION_DEPTH = 20
/** Сколько задач читаем одновременно: SDK всё равно выравнивает вызовы под лимит REST портала. */
const READ_CONCURRENCY = 4

type Step = 'idle' | 'loading' | 'collecting' | 'preview' | 'writing' | 'done'

export function useInvoiceFill() {
  const b24 = useB24()
  const { post } = useApi()
  const { settings, rates, userId } = useAppSettings()
  const users = useUsers()

  const invoice = ref<InvoiceInfo | null>(null)
  const existing = ref<ExistingRow[]>([])
  const tasks = ref<TaskInfo[]>([])
  const result = ref<FillResult | null>(null)
  /** Проблемы уровня счёта/настроек (валюта, нет сделки) — до чтения задач. */
  const problems = ref<string[]>([])
  const step = ref<Step>('idle')
  const error = ref('')
  /** Предупреждение после записи (например, счёт не удалось перечитать) — запись при этом прошла. */
  const notice = ref('')

  const canWrite = computed(() => step.value === 'preview' && !!result.value && result.value.errors.length === 0 && result.value.rows.length > 0)
  const total = computed(() => rowsTotal(result.value?.rows ?? []))

  /**
   * Все позиции счёта, постранично: у счёта их может быть больше страницы. Упёрлись в потолок —
   * ошибка, а не тихо неполный список: по нему считается порядок новых строк и «добавлено N».
   */
  async function fetchExistingRows(id: number): Promise<ExistingRow[]> {
    const out: ExistingRow[] = []
    for (let start = 0; ; start += PRODUCT_ROWS_PAGE) {
      if (start >= MAX_PRODUCT_ROWS) throw new Error(`в счёте #${id} больше ${MAX_PRODUCT_ROWS} позиций — такой счёт приложение не обрабатывает`)
      const res = await b24.call<{ productRows?: unknown[] }>('crm.item.productrow.list', {
        filter: { '=ownerType': INVOICE_OWNER_TYPE, '=ownerId': id },
        order: { id: 'asc' },
        start
      })
      const page = res?.productRows ?? []
      out.push(...parseExistingRows(page))
      if (page.length < PRODUCT_ROWS_PAGE) return out
    }
  }

  /** Счёт и его позиции. Состояние шага не трогает — это делают вызывающие. */
  async function readInvoice(id: number): Promise<void> {
    const [item, rows] = await Promise.all([
      b24.call('crm.item.get', { entityTypeId: INVOICE_ENTITY_TYPE_ID, id }),
      fetchExistingRows(id)
    ])
    const parsed = parseInvoice(item)
    if (!parsed) throw new Error(`Счёт #${id} не найден или нет доступа`)
    invoice.value = parsed
    existing.value = rows
  }

  async function loadInvoice(id: number): Promise<void> {
    step.value = 'loading'
    error.value = ''
    try {
      await readInvoice(id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      step.value = 'idle'
    }
  }

  /** Сбросить предпросмотр: сменили источник или тип — старые строки к новым настройкам не относятся. */
  function reset(): void {
    if (step.value === 'collecting' || step.value === 'writing') return
    result.value = null
    problems.value = []
    notice.value = ''
    step.value = 'idle'
  }

  /** Задачи по привязке. Ищем по каждому коду и перепроверяем привязку сами (tasks.ts). */
  async function fetchTasks(source: TaskSource, inv: InvoiceInfo): Promise<TaskInfo[]> {
    const codes = source === 'deal'
      ? crmBindingCodes(DEAL_ENTITY_TYPE_ID, inv.dealId!)
      : crmBindingCodes(INVOICE_ENTITY_TYPE_ID, inv.id)
    const rows: Record<string, unknown>[] = []
    for (const code of codes) {
      // ⚠ Фильтр ОБЪЕКТОМ — форма REST v2; форма v3 (массив) на /rest/ отвергается (замер get-task-from-b24).
      const found = await b24.callList<Record<string, unknown>>('tasks.task.list', {
        filter: { UF_CRM_TASK: code },
        select: TASK_SELECT
      }, { idKey: 'id', cursorIdKey: 'ID', customKeyForResult: 'tasks' })
      rows.push(...found)
    }
    return tasksBoundTo(rows, codes)
  }

  /**
   * Все записи времени задачи, постранично. Параметры — позиционные, как в примере документации.
   * Упёрлись в потолок страниц — ошибка, а не тихо неполная сумма (находка ревью).
   */
  async function fetchEntries(taskId: number): Promise<TimeEntry[]> {
    const out: TimeEntry[] = []
    for (let page = 1; ; page++) {
      if (page > MAX_ELAPSED_PAGES) throw new Error(`в задаче #${taskId} больше ${MAX_ELAPSED_PAGES * ELAPSED_PAGE} записей времени — такой объём приложение не считает`)
      const res = await b24.getOrThrow().actions.v2.call.make({
        method: 'task.elapseditem.getlist',
        params: [taskId, { ID: 'asc' }, {}, ['*'], { NAV_PARAMS: { nPageSize: ELAPSED_PAGE, iNumPage: page } }] as unknown as Record<string, unknown>
      })
      if (!res.isSuccess) throw new B24CallError('task.elapseditem.getlist', res.getErrorMessages())
      const rows = listRows(res.getData()?.result)
      for (const row of rows) {
        const entry = parseTimeEntry(row)
        if (entry) out.push(entry)
      }
      if (rows.length < ELAPSED_PAGE || out.length >= res.getTotal()) break
    }
    return out
  }

  /** Отчёты (результаты) задачи — контекст для названий в режиме ИИ. Не обязательны: сбой не останавливает. */
  async function fetchResults(taskId: number): Promise<string> {
    try {
      const res = await b24.call<unknown>('tasks.task.result.list', { taskId })
      return listRows(res).map(r => String(r.text ?? r.TEXT ?? '')).filter(Boolean).join('\n')
    } catch {
      return ''
    }
  }

  /** Папки товаров каталога, от ближайшей к корню. Товар не найден — ошибка заполнения. */
  async function fetchProducts(ids: number[]): Promise<{ products: Map<number, ProductInfo>, missing: number[] }> {
    const products = new Map<number, ProductInfo>()
    const missing: number[] = []
    const parentOf = new Map<number, number | null>()
    for (const id of ids) {
      let sectionId: number | null
      try {
        const res = await b24.call<{ product?: { iblockSectionId?: unknown } }>('catalog.product.get', { id })
        sectionId = Number(res?.product?.iblockSectionId) || null
      } catch {
        missing.push(id)
        continue
      }
      const chain: number[] = []
      for (let depth = 0; sectionId && depth < MAX_SECTION_DEPTH && !chain.includes(sectionId); depth++) {
        chain.push(sectionId)
        if (!parentOf.has(sectionId)) {
          const sec = await b24.call<{ section?: { iblockSectionId?: unknown } }>('catalog.section.get', { id: sectionId })
          parentOf.set(sectionId, Number(sec?.section?.iblockSectionId) || null)
        }
        sectionId = parentOf.get(sectionId) ?? null
      }
      products.set(id, { sectionChain: chain })
    }
    return { products, missing }
  }

  async function collect(source: TaskSource, mode: FillMode): Promise<void> {
    const inv = invoice.value
    if (!inv) return
    step.value = 'collecting'
    error.value = ''
    notice.value = ''
    result.value = null
    problems.value = invoiceProblems(inv, settings.value, source)
    if (problems.value.length) {
      step.value = 'idle'
      return
    }
    try {
      tasks.value = await fetchTasks(source, inv)
      const entries = (await mapLimit(tasks.value, READ_CONCURRENCY, task => fetchEntries(task.id))).flat()

      const involved = new Set<number>()
      tasks.value.forEach(t => t.responsibleId && involved.add(t.responsibleId))
      entries.forEach(e => e.userId && involved.add(e.userId))

      // Товары — только из ставок тех, кто участвует в строках, и товар по умолчанию.
      const productIds = new Set<number>()
      if (settings.value.defaultProductId) productIds.add(settings.value.defaultProductId)
      rates.value.forEach(r => r.productId && involved.has(r.userId) && productIds.add(r.productId))
      const [{ products, missing }] = await Promise.all([fetchProducts([...productIds]), users.load([...involved])])
      const userNames = new Map(Object.entries(users.names.value).map(([id, name]) => [Number(id), name]))

      let built = buildRows({ mode, tasks: tasks.value, entries, rates: rates.value, settings: settings.value, products, userNames })
      const usedMissing = missing.filter(id => built.rows.some(r => r.productId === id))
      for (const id of usedMissing) built.errors.push({ taskId: 0, message: `товар каталога #${id} не найден или нет доступа — проверьте настройки ставок` })

      if (settings.value.naming === 'ai' && built.errors.length === 0 && built.rows.length > 0) {
        const names: Record<string, string> = {}
        // Пакетами по MAX_NAMING_ITEMS: сервер больше за раз не примет (бюджет модели).
        for (const part of chunk(await namingItems(mode, built), MAX_NAMING_ITEMS)) {
          const res = await post<{ names: Record<string, string> }>('/api/ai/names', { mode, items: part })
          Object.assign(names, res.names)
        }
        const named = applyNames(built.rows, names)
        built = { ...built, rows: named.rows, errors: named.errors }
      }
      result.value = built
      step.value = 'preview'
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      step.value = 'idle'
    }
  }

  async function namingItems(mode: FillMode, built: FillResult): Promise<NamingItem[]> {
    const byTask = new Map(tasks.value.map(t => [t.id, t]))
    // Урезаем до отправки — как урежет сервер (clipNamingItem): тело запроса ограничено.
    if (mode === 'time') {
      return built.rows.map(r => clipNamingItem({ key: r.key, title: byTask.get(r.taskId)?.title ?? '', text: r.name }))
    }
    return mapLimit(built.rows, READ_CONCURRENCY, async (r) => {
      const task = byTask.get(r.taskId)
      return clipNamingItem({ key: r.key, title: task?.title ?? r.name, text: task?.description ?? '', result: await fetchResults(r.taskId) })
    })
  }

  /**
   * Запись в счёт.
   * • «Заменить» — один вызов crm.item.productrow.set: все позиции заменяются набором.
   * • «Добавить» — crm.item.productrow.add по одной строке: set с неполными полями обнулил бы
   *   цены существующих строк («Если не передана, цена будет равна 0» — документация).
   *   ⚠ Пакет add не транзакция: при ошибке посередине часть строк уже добавлена. Поэтому пакет
   *   останавливается на первой ошибке, счёт перечитывается, человеку говорится, СКОЛЬКО строк
   *   добавилось, а предпросмотр сбрасывается — повторное нажатие не задвоит строки (находка
   *   /code-review этого PR).
   */
  async function write(replace: boolean): Promise<void> {
    const inv = invoice.value
    if (!inv || !canWrite.value || !result.value) return
    step.value = 'writing'
    error.value = ''
    notice.value = ''
    const before = existing.value.length
    const planned = result.value.rows.length
    try {
      if (replace) {
        await b24.call('crm.item.productrow.set', { ownerType: INVOICE_OWNER_TYPE, ownerId: inv.id, productRows: toProductRows(result.value.rows, settings.value) })
      } else {
        const sortStart = existing.value.reduce((max, r) => Math.max(max, r.sort), 0)
        const rows = toProductRows(result.value.rows, settings.value, sortStart)
        await b24.batch(rows.map(fields => ['crm.item.productrow.add', { fields: { ownerType: INVOICE_OWNER_TYPE, ownerId: inv.id, ...fields } }]), { haltOnError: true })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (replace) {
        error.value = `Счёт не изменён: ${message}`
        step.value = 'preview'
        return
      }
      // Сколько успело добавиться — по перечитанному счёту. Не перечитался — так и говорим,
      // а не «добавлено 0»: строки могли уйти.
      const reread = await readInvoice(inv.id).then(() => true, () => false)
      const done = reread
        ? `Добавлено ${Math.max(0, existing.value.length - before)} из ${planned} строк`
        : `Сколько строк из ${planned} успело добавиться, проверить не удалось`
      error.value = `${done}, дальше — ошибка: ${message}. Проверьте счёт; чтобы не задвоить строки, соберите их заново.`
      result.value = null
      step.value = 'idle'
      return
    }
    try {
      await readInvoice(inv.id)
    } catch {
      notice.value = 'Строки записаны, но счёт не удалось перечитать — обновите карточку счёта.'
    }
    step.value = 'done'
  }

  /** Консультация: ответ BitrixGPT по промпту из настроек → дело в счёте. */
  async function consult(promptId: string): Promise<{ title: string, text: string }> {
    const inv = invoice.value
    if (!inv) throw new Error('Счёт не загружен')
    // Урезаем до того, что сервер отдаст модели: большой счёт иначе упёрся бы в предел тела запроса.
    const context = fitConsultContext({
      invoice: { title: inv.title, currency: inv.currencyId, amount: inv.opportunity },
      rows: existing.value.map(r => ({ name: r.productName, quantity: r.quantity, price: r.price })),
      tasks: tasks.value.map(t => ({ id: t.id, title: t.title, description: t.description.slice(0, 1000), hours: Math.round(t.timeSpentInLogs / 36) / 100 }))
    })
    const answer = await post<{ title: string, text: string }>('/api/ai/consult', { promptId, context })
    const res = await b24.call<{ id?: unknown } | number>('crm.activity.todo.add', buildConsultActivity({
      invoiceId: inv.id, promptTitle: answer.title, answer: answer.text, responsibleId: userId.value, nowMs: Date.now()
    }))
    const activityId = typeof res === 'number' ? res : Number((res as { id?: unknown })?.id)
    if (activityId > 0) {
      await b24.call('crm.activity.update', { id: activityId, fields: { DESCRIPTION_TYPE: DESCRIPTION_TYPE_BB } }).catch(() => undefined)
    }
    return answer
  }

  return { invoice, existing, tasks, result, problems, step, error, notice, canWrite, total, loadInvoice, reset, collect, write, consult }
}
