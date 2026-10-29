// Сборка строк товарной части счёта из задач. Чистая функция: на входе задачи, записи
// времени, ставки и настройки — на выходе строки и список проблем. Никаких REST-вызовов:
// их делает composable страницы (app/composables/useInvoiceFill.ts).
//
// Правила (ТЗ + решения владельца по #3, записанные в docs/PROCESSING.md):
// • тип 1 «задача» — одна строка на задачу; всё время задачи (всех участников) умножается на
//   ставку ОТВЕТСТВЕННОГО, действующую на дату последней записи времени; если за период задачи
//   ставка менялась — предупреждение;
// • тип 2 «время» — одна строка на запись времени; ставка того, кто списал время, на дату записи;
// • ставка клиента (компании, затем контакта счёта) важнее общей ставки сотрудника (rates.ts);
// • дата записи — дата её создания (tasks.ts);
// • наценка — по тегам задачи, первое совпадение, иначе «на всё» (markup.ts);
// • валюта счёта ≠ валюте ставок — цены пересчитываются по курсу портала (currency.ts);
// • в счёт — цена часа и часы или сумма строки и 1 (настройка priceMode);
// • цена — без НДС, налог сверху по «Реквизитам вашей компании» счёта (vat.ts);
// • если чего-то не хватает — ошибка, и НИЧЕГО не пишется (ТЗ: «стоп работа и показ ошибки»).
//   Ошибки собираются все сразу, чтобы человек исправил задачи за один проход.

import type { CurrencyConversion } from './currency'
import { applyMarkup, resolveMarkup, type MarkupSource } from './markup'
import { clientKey, findRate, type RateEntry } from './rates'
import type { AppSettings, PriceMode } from './settings'
import { openTaskStatus, type TaskInfo, type TimeEntry } from './tasks'
import { formatDuration, formatRuDate, roundSeconds, secondsToHours } from './time'
import { roundMoney } from './money'
import { grossPrice, type VatRate } from './vat'

/** Тип заполнения: 1 — задача как учётная единица, 2 — записи затраченного времени. */
export type FillMode = 'task' | 'time'
/** Откуда брать задачи. Смешивать источники нельзя (ТЗ). */
export type TaskSource = 'deal' | 'invoice'

/** Длина названия товара в строке — у поля товарной позиции предел 255 символов. */
export const MAX_ROW_NAME = 255

export interface FillInput {
  mode: FillMode
  /** Задачи; теги (`tags`) нужны, только если в настройках есть правила наценки по тегам. */
  tasks: TaskInfo[]
  entries: TimeEntry[]
  rates: RateEntry[]
  /** Клиенты счёта для ставок клиента (invoiceClients): компания, затем контакты. */
  clients?: readonly string[]
  settings: AppSettings
  /** Пересчёт в валюту счёта; `null`/нет — валюты совпадают. */
  conversion?: CurrencyConversion | null
  /** Ставка НДС счёта (vatForInvoice); `null` — «Без НДС». */
  vatRate: VatRate
  /** Имена сотрудников для понятных сообщений; нет имени — пишем `#ID`. */
  userNames?: Map<number, string>
  /**
   * Оценка часов от ИИ для задач без затраченного времени (планирование, решение владельца
   * 2026-10-07): ID задачи → часы. Нет оценки — строка с нулём и предупреждением.
   */
  estimates?: ReadonlyMap<number, number>
  /** Сегодня (`YYYY-MM-DD`, пояс портала) — дата ставки для задачи без времени. */
  today?: string
}

export interface DraftRow {
  /** Ключ строки: `t<taskId>` (тип 1) или `e<entryId>` (тип 2). По нему приходят имена от BitrixGPT. */
  key: string
  taskId: number
  /** ID задачи клиента (UF из настроек) — вторым в «[123-456]» названия. */
  clientTaskId?: string | null
  entryId?: number
  userId: number
  name: string
  /** Исходная длительность и после округления, секунды. */
  seconds: number
  roundedSeconds: number
  /** Часы после округления. */
  hours: number
  /** Ставка без наценки в валюте ставок и дата, на которую она выбрана. */
  baseRate: number
  rateDate: string
  markupPercent: number
  markupSource: MarkupSource
  /** Тег сработавшего правила наценки (`markupSource = 'tag'`). */
  markupTag?: string
  /** Цена часа с наценкой в валюте счёта, без НДС. */
  hourPrice: number
  /**
   * Что уходит в строку счёта (priceMode): `hour` — цена часа и часы, `sum` — сумма строки и 1.
   * Цена — без НДС: налог добавляет toProductRows.
   */
  price: number
  quantity: number
  /** Сумма строки без НДС для предпросмотра (портал считает её сам). */
  sum: number
  /** Ставка НДС строки — одна на счёт; `null` — «Без НДС». */
  taxRate: VatRate
  /** Сумма по формуле (часы × цена часа), без НДС — с ней сравнивается выставленное (economics.ts). */
  formulaSum: number
  /** Часы — оценка ИИ: в задаче нет затраченного времени. */
  estimated?: boolean
  /**
   * Время по людям (тип «Задача — одна строка», владелец 2026-10-29): у каждого участника своя
   * ставка; часы без автора записи — по ставке ответственного (`noAuthor`). Сумма строки — сумма
   * сумм участников.
   */
  people?: PersonHours[]
  /**
   * «Стоимость работ» задачи — итог строки С НАЛОГОМ, который платит клиент: в счёт уходит ровно
   * эта цена × 1, цена без налога — обратным счётом (toProductRows, решение владельца).
   */
  fixedGross?: number
}

/** Часы одного участника задачи и их цена. */
export interface PersonHours {
  userId: number
  seconds: number
  roundedSeconds: number
  hours: number
  /** Ставка без наценки и дата, на которую она выбрана (последняя запись участника). */
  baseRate: number
  rateDate: string
  /** Цена часа с наценкой в валюте счёта, без НДС. */
  hourPrice: number
  /** Часы × цена часа, без НДС. */
  sum: number
  /** Записи без автора — посчитаны по ставке ответственного. */
  noAuthor?: boolean
}

export interface FillIssue {
  /** Задача, к которой относится проблема; `0` — к счёту целиком (валюта, «нет задач»). */
  taskId: number
  entryId?: number
  message: string
}

/** Незакрытая задача: не мешает записи, но время в ней ещё может добавиться. */
export interface OpenTask {
  taskId: number
  /** Название статуса, как в карточке задачи («выполняется»). */
  status: string
}

export interface FillResult {
  rows: DraftRow[]
  /** Режим, которым собраны строки, — подпись предпросмотра берёт его, а не текущие настройки. */
  priceMode: PriceMode
  errors: FillIssue[]
  /** Не мешают записи, но о них стоит знать (пересчёт валюты, смена ставки, пропуски). */
  warnings: FillIssue[]
  /**
   * Незакрытые задачи — отдельно от предупреждений: их бывает много (сделка из 30 задач в
   * работе), и строкой на задачу они похоронили бы предупреждения, меняющие суммы.
   */
  openTasks: OpenTask[]
  /** Задачи, чьё время заметно больше обычного для этого счёта ({@link timeOutliers}) — проверить. */
  outliers: TimeOutlier[]
}

/** Задача с временем заметно больше обычного: не стоп, а подсказка проверить. */
export interface TimeOutlier {
  taskId: number
  /** Время задачи в счёте (после округления), секунды. */
  seconds: number
  /** Обычное время задачи в этом счёте — медиана по задачам, секунды. */
  typicalSeconds: number
}

/**
 * «Резко больше» — больше обычного более чем на 40% (владелец, 2026-09-28: «больше чем на 40%»):
 * ровно +40% — ещё не выброс. Процентом, а не множителем 1.4: сравнение идёт в целых числах —
 * `5400 * 1.4` в плавающей точке даёт 7559.999…, и задача ровно на +40% попала бы в выбросы
 * (находка /code-review).
 */
export const OUTLIER_PERCENT = 40
/** Сравнивать есть с чем — хотя бы 3 задачи: из двух «основной массы» не сложить. */
export const OUTLIER_MIN_TASKS = 3

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Задачи, чьё время выбивается вверх из основной массы (просьба владельца 2026-09-28: «подсветить
 * и проверить»): время задачи в счёте (сумма округлённых строк, в типе 2 — всех её записей) больше
 * медианы по задачам более чем на 40%. Только вверх: короткий звонок среди длинных задач — не
 * ошибка, а «списал 20 ч вместо 2 ч» — частая. Задач меньше трёх — не сравниваем. Строк с нулём
 * после округления в `rows` нет (сборка их пропускает с предупреждением), поэтому у каждой задачи
 * время больше нуля.
 */
export function timeOutliers(rows: readonly DraftRow[]): TimeOutlier[] {
  const byTask = new Map<number, number>()
  for (const row of rows) byTask.set(row.taskId, (byTask.get(row.taskId) ?? 0) + row.roundedSeconds)
  if (byTask.size < OUTLIER_MIN_TASKS) return []
  const typical = median([...byTask.values()])
  return [...byTask.entries()]
    .filter(([, seconds]) => seconds * 100 > typical * (100 + OUTLIER_PERCENT))
    .map(([taskId, seconds]) => ({ taskId, seconds, typicalSeconds: typical }))
}

function userLabel(input: FillInput, userId: number): string {
  return input.userNames?.get(userId) ?? `#${userId}`
}

/** Обрезка названия до предела поля с многоточием; пробелы по краям и переводы строк убираем. */
export function clampName(name: string): string {
  const flat = name.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_ROW_NAME ? `${flat.slice(0, MAX_ROW_NAME - 1)}…` : flat
}

/**
 * Цена часа: ставка → пересчёт в валюту счёта → наценка по тегам задачи. Округление до копеек —
 * один раз, в конце (applyMarkup): двойное округление давало бы расхождение на копейки.
 */
function priceFor(input: FillInput, task: TaskInfo, rate: RateEntry): Pick<DraftRow, 'markupPercent' | 'markupSource' | 'markupTag' | 'price'> {
  const markup = resolveMarkup(input.settings.markup, task.tags)
  return {
    markupPercent: markup.percent,
    markupSource: markup.source,
    ...(markup.tag ? { markupTag: markup.tag } : {}),
    price: applyMarkup(rate.rate * (input.conversion?.factor ?? 1), markup.percent)
  }
}

function rateLabel(rate: RateEntry | null): string {
  const who = rate?.client ? (rate.client.startsWith('CO_') ? ' (ставка компании)' : ' (ставка контакта)') : ''
  return rate ? `${rate.rate} с ${formatRuDate(rate.from)}${who}` : 'нет ставки'
}

/**
 * Менялась ли ставка ответственного за период задачи (тип 1, решение владельца по #3: берём
 * ставку на последнюю запись, но сообщаем о смене). Сравниваются версии ставки на даты всех
 * записей со временем; «нет ставки» на ранние даты — тоже смена.
 */
function rateChangeWarning(input: FillInput, userId: number, dates: string[], applied: RateEntry): string | null {
  const versions = new Map<string, RateEntry | null>()
  for (const date of dates) {
    const rate = findRate(input.rates, userId, date, input.clients)
    // Ключ — клиент и дата: ставка клиента и общая с одной даты — разные версии.
    versions.set(rate ? `${clientKey(rate)}|${rate.from}` : '', rate)
  }
  if (versions.size < 2) return null
  const chain = [...versions.values()].sort((a, b) => (a?.from ?? '').localeCompare(b?.from ?? '')).map(rateLabel)
  return `ставка ${userLabel(input, userId)} менялась за время задачи: ${chain.join(' → ')}; применена ${applied.rate} — на дату последней записи`
}

/**
 * Цена и количество строки по настройке priceMode. Сумма — от цены часа и часов в обоих режимах,
 * поэтому режим не меняет итог счёта (кроме копеек округления цены за всю строку в режиме `sum`).
 */
function placed(input: FillInput, hourPrice: number, hours: number): Pick<DraftRow, 'hourPrice' | 'price' | 'quantity' | 'sum' | 'taxRate' | 'formulaSum'> {
  const sum = roundMoney(hourPrice * hours)
  return input.settings.priceMode === 'sum'
    ? { hourPrice, price: sum, quantity: 1, sum, taxRate: input.vatRate, formulaSum: sum }
    : { hourPrice, price: hourPrice, quantity: hours, sum, taxRate: input.vatRate, formulaSum: sum }
}

/**
 * Строка с «Стоимостью работ» (тип «Задача — одна строка»): клиент платит ровно `gross` — цена × 1;
 * сумма без налога для предпросмотра — обратным счётом. Формула остаётся для сравнения.
 */
function fixedPlaced(input: FillInput, hourPrice: number, hours: number, gross: number, formula = roundMoney(hourPrice * hours)): Pick<DraftRow, 'hourPrice' | 'price' | 'quantity' | 'sum' | 'taxRate' | 'formulaSum' | 'fixedGross'> {
  const net = netOfGross(gross, input.vatRate)
  return { hourPrice, price: net, quantity: 1, sum: net, taxRate: input.vatRate, formulaSum: formula, fixedGross: gross }
}

/** Цена без налога из итога с налогом, до копеек. */
export function netOfGross(gross: number, rate: VatRate): number {
  return rate === null || rate === 0 ? gross : roundMoney(gross * 100 / (100 + rate))
}

/**
 * Задача без затраченного времени (планирование): не стоп, а предупреждение (решение владельца
 * 2026-10-07). Часы — оценка ИИ (`estimates`), ставка — ответственного на сегодня; «Стоимость
 * работ» задаёт итог строки. Нет ни оценки, ни стоимости — строка с нулём.
 */
function plannedTaskRow(input: FillInput, task: TaskInfo, result: FillResult): void {
  if (!task.title) result.errors.push({ taskId: task.id, message: 'у задачи нет названия' })
  if (task.responsibleId === null) result.errors.push({ taskId: task.id, message: 'у задачи нет ответственного' })
  if (!task.title || task.responsibleId === null) return
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  const rate = findRate(input.rates, task.responsibleId, today, input.clients)
  if (!rate) {
    result.errors.push({ taskId: task.id, message: `нет ставки для ${userLabel(input, task.responsibleId)} на ${formatRuDate(today)}` })
    return
  }
  const estimate = input.estimates?.get(task.id)
  const { rounding: step, roundingDirection: direction } = input.settings
  const seconds = estimate && estimate > 0 ? Math.round(estimate * 3600) : 0
  const rounded = seconds ? Math.max(roundSeconds(seconds, step, direction), 0) : 0
  const hours = secondsToHours(rounded)
  result.warnings.push({
    taskId: task.id,
    message: estimate
      ? `в задаче нет затраченного времени — часы оценил ИИ: ${formatDuration(rounded)}${task.workCost !== null && input.mode === 'task' ? ', в счёт — «Стоимость работ»' : ''}`
      : task.workCost !== null && input.mode === 'task'
        ? 'в задаче нет затраченного времени — в счёт идёт «Стоимость работ», сравнить не с чем'
        : 'в задаче нет затраченного времени и оценки ИИ — строка с нулём, поправьте цену в счёте'
  })
  const { price: hourPrice, ...markup } = priceFor(input, task, rate)
  result.rows.push({
    key: `t${task.id}`,
    taskId: task.id,
    clientTaskId: task.clientTaskId,
    userId: task.responsibleId,
    name: clampName(task.title),
    seconds: 0,
    roundedSeconds: rounded,
    hours,
    baseRate: rate.rate,
    rateDate: today,
    ...markup,
    ...(task.workCost !== null && input.mode === 'task' ? fixedPlaced(input, hourPrice, hours, task.workCost) : placed(input, hourPrice, hours)),
    estimated: true
  })
}

/** Ноль после округления возможен только «к ближайшему» — но текст от направления не зависит. */
function zeroAfterRounding(seconds: number): string {
  return `время ${formatDuration(seconds)} после округления стало нулём — строка пропущена`
}

/**
 * Тип «Задача — одна строка»: сумма задачи = время каждого участника × его ставка на дату его
 * последней записи (+ наценка задачи); записи без автора — по ставке ответственного, с
 * предупреждением (владелец 2026-10-29, дизайн v2). Округление — по каждому участнику.
 */
function buildTaskRows(input: FillInput, result: FillResult): void {
  const { rounding: step, roundingDirection: direction } = input.settings
  for (const task of input.tasks) {
    const entries = input.entries.filter(e => e.taskId === task.id && e.seconds > 0)
    const total = entries.reduce((sum, e) => sum + e.seconds, 0)
    if (total === 0 && task.timeSpentInLogs === 0) {
      plannedTaskRow(input, task, result)
      continue
    }
    const problems: string[] = []
    if (!task.title) problems.push('у задачи нет названия')
    if (task.responsibleId === null) problems.push('у задачи нет ответственного')
    if (total === 0) problems.push('журнал времени задачи не прочитан (нет доступа к записям времени?)')
    if (problems.length || task.responsibleId === null) {
      for (const message of problems) result.errors.push({ taskId: task.id, message })
      continue
    }
    // Участники: автор записи, без автора — ответственный (отдельной группой, чтобы подсветить)
    const groups = new Map<string, { userId: number, noAuthor: boolean, entries: TimeEntry[] }>()
    for (const e of entries) {
      const noAuthor = e.userId === null
      const userId = e.userId ?? task.responsibleId
      const key = noAuthor ? 'none' : `u${userId}`
      const g = groups.get(key) ?? { userId, noAuthor, entries: [] }
      g.entries.push(e)
      groups.set(key, g)
    }
    const markup = resolveMarkup(input.settings.markup, task.tags)
    const people: PersonHours[] = []
    let failed = false
    for (const g of groups.values()) {
      const dates = [...new Set(g.entries.map(e => e.date).filter((d): d is string => !!d))].sort()
      const lastDate = dates.at(-1)
      if (!lastDate) {
        result.errors.push({ taskId: task.id, message: `у записей времени ${userLabel(input, g.userId)} нет даты — не на что выбрать ставку` })
        failed = true
        continue
      }
      const rate = findRate(input.rates, g.userId, lastDate, input.clients)
      if (!rate) {
        result.errors.push({ taskId: task.id, message: `нет ставки для ${userLabel(input, g.userId)} на ${formatRuDate(lastDate)}` })
        failed = true
        continue
      }
      const changed = rateChangeWarning(input, g.userId, dates, rate)
      if (changed) result.warnings.push({ taskId: task.id, message: changed })
      const seconds = g.entries.reduce((sum, e) => sum + e.seconds, 0)
      const rounded = roundSeconds(seconds, step, direction)
      const hours = secondsToHours(rounded)
      const hourPrice = applyMarkup(rate.rate * (input.conversion?.factor ?? 1), markup.percent)
      people.push({ userId: g.userId, seconds, roundedSeconds: rounded, hours, baseRate: rate.rate, rateDate: lastDate, hourPrice, sum: roundMoney(hourPrice * hours), ...(g.noAuthor ? { noAuthor: true } : {}) })
    }
    if (failed) continue
    const noAuthor = people.find(p => p.noAuthor)
    if (noAuthor) {
      result.warnings.push({ taskId: task.id, message: `${formatDuration(noAuthor.roundedSeconds)} без автора записи — посчитаны по ставке ответственного ${userLabel(input, task.responsibleId)} (${noAuthor.baseRate}); укажите автора записи, если работал другой` })
    }
    const rounded = people.reduce((sum, p) => sum + p.roundedSeconds, 0)
    if (rounded === 0) {
      result.warnings.push({ taskId: task.id, message: zeroAfterRounding(total) })
      continue
    }
    const hours = secondsToHours(rounded)
    const sum = roundMoney(people.reduce((acc, p) => acc + p.sum, 0))
    // Цена часа строки — средняя по участникам (для подписи); строка — точная сумма участников
    const hourPrice = people.length === 1 ? people[0]!.hourPrice : roundMoney(sum / hours)
    const main = people.find(p => p.userId === task.responsibleId && !p.noAuthor) ?? people[0]!
    const lastDate = people.map(p => p.rateDate).sort().at(-1)!
    result.rows.push({
      key: `t${task.id}`,
      taskId: task.id,
      clientTaskId: task.clientTaskId,
      userId: task.responsibleId,
      name: clampName(task.title),
      seconds: total,
      roundedSeconds: rounded,
      hours,
      baseRate: main.baseRate,
      rateDate: lastDate,
      markupPercent: markup.percent,
      markupSource: markup.source,
      ...(markup.tag ? { markupTag: markup.tag } : {}),
      ...(task.workCost !== null ? fixedPlaced(input, hourPrice, hours, task.workCost, sum) : placedSum(input, hourPrice, hours, sum, new Set(people.map(p => p.hourPrice)).size > 1)),
      people
    })
  }
}

/**
 * Как `placed`, но сумма задана (сумма участников). Цены часа участников разные — строка «сумма × 1»
 * и в режиме «цена часа»: средняя цена × часы разошлась бы с суммой на копейки (находка панели).
 */
function placedSum(input: FillInput, hourPrice: number, hours: number, sum: number, mixed: boolean): Pick<DraftRow, 'hourPrice' | 'price' | 'quantity' | 'sum' | 'taxRate' | 'formulaSum'> {
  return input.settings.priceMode === 'sum' || mixed
    ? { hourPrice, price: sum, quantity: 1, sum, taxRate: input.vatRate, formulaSum: sum }
    : { hourPrice, price: hourPrice, quantity: hours, sum: roundMoney(hourPrice * hours), taxRate: input.vatRate, formulaSum: sum }
}

function buildTimeRows(input: FillInput, result: FillResult): void {
  const { rounding: step, roundingDirection: direction } = input.settings
  for (const task of input.tasks) {
    const entries = input.entries.filter(e => e.taskId === task.id)
    if (entries.length === 0 && task.timeSpentInLogs === 0) {
      plannedTaskRow(input, task, result)
      continue
    }
    if (entries.length === 0) {
      result.errors.push({ taskId: task.id, message: 'журнал времени задачи не прочитан (нет доступа к записям времени?)' })
      continue
    }
    if (task.workCost !== null) {
      result.warnings.push({ taskId: task.id, message: '«Стоимость работ» учитывается в типе «Задача — одна строка»; здесь строки — по записям времени' })
    }
    for (const entry of entries) {
      if (entry.seconds === 0) {
        result.warnings.push({ taskId: task.id, entryId: entry.id, message: 'запись времени нулевой длины пропущена' })
        continue
      }
      const problems: string[] = []
      if (!entry.comment) problems.push(`у записи времени ${formatDuration(entry.seconds)} нет описания — нечем назвать строку`)
      if (entry.userId === null) problems.push('у записи времени не указан сотрудник')
      if (!entry.date) problems.push('у записи времени нет даты')
      let rate: RateEntry | null = null
      if (entry.userId !== null && entry.date) {
        rate = findRate(input.rates, entry.userId, entry.date, input.clients)
        if (!rate) problems.push(`нет ставки для ${userLabel(input, entry.userId)} на ${formatRuDate(entry.date)}`)
      }
      if (problems.length || !rate || entry.userId === null || !entry.date) {
        for (const message of problems) result.errors.push({ taskId: task.id, entryId: entry.id, message })
        continue
      }
      const rounded = roundSeconds(entry.seconds, step, direction)
      if (rounded === 0) {
        result.warnings.push({ taskId: task.id, entryId: entry.id, message: zeroAfterRounding(entry.seconds) })
        continue
      }
      const hours = secondsToHours(rounded)
      const { price: hourPrice, ...markup } = priceFor(input, task, rate)
      result.rows.push({
        key: `e${entry.id}`,
        taskId: task.id,
        clientTaskId: task.clientTaskId,
        entryId: entry.id,
        userId: entry.userId,
        name: clampName(entry.comment),
        seconds: entry.seconds,
        roundedSeconds: rounded,
        hours,
        baseRate: rate.rate,
        rateDate: entry.date,
        ...markup,
        ...placed(input, hourPrice, hours)
      })
    }
  }
}

/**
 * Собирает строки счёта. Если `errors` не пуст — писать в счёт нельзя, даже частично.
 */
export function buildRows(input: FillInput): FillResult {
  const result: FillResult = { rows: [], priceMode: input.settings.priceMode, errors: [], warnings: [], openTasks: [], outliers: [] }
  if (input.tasks.length === 0) {
    result.errors.push({ taskId: 0, message: 'не найдено ни одной задачи' })
    return result
  }
  if (input.mode === 'task') buildTaskRows(input, result)
  else buildTimeRows(input, result)
  // Незакрытые задачи — предупреждение, не стоп: счёт бывает и до закрытия задачи.
  for (const task of input.tasks) {
    const status = openTaskStatus(task.status)
    if (status) result.openTasks.push({ taskId: task.id, status })
  }
  result.outliers = timeOutliers(result.rows)
  // Клиента у счёта нет (или не прочитался), а у сотрудников строк есть ставки клиентов —
  // предупреждение: иначе общая ставка вместо клиентской прошла бы молча.
  if (!input.clients?.length) {
    const users = new Set(result.rows.map(r => r.userId))
    if (input.rates.some(r => r.client && users.has(r.userId))) {
      result.warnings.push({ taskId: 0, message: 'у счёта не указан клиент (компания или контакт) — применены общие ставки, ставки клиентов не учтены' })
    }
  }
  // Пересчёт валюты — первым предупреждением: он касается каждой цены в счёте.
  if (input.conversion && result.rows.length) result.warnings.unshift({ taskId: 0, message: input.conversion.notice })
  return result
}

/**
 * Подставляет названия от BitrixGPT. Строка без названия — ошибка, а не тихий откат к
 * исходному тексту: человек выбрал режим ИИ и должен узнать, что он не сработал.
 */
export function applyNames(rows: DraftRow[], names: Record<string, string>): { rows: DraftRow[], errors: FillIssue[] } {
  const errors: FillIssue[] = []
  const out = rows.map((row) => {
    const name = clampName(typeof names[row.key] === 'string' ? names[row.key]! : '')
    if (!name) {
      errors.push({ taskId: row.taskId, ...(row.entryId ? { entryId: row.entryId } : {}), message: 'ИИ не вернул название строки' })
      return row
    }
    return { ...row, name }
  })
  return { rows: out, errors }
}

/**
 * Название строки с ID задачи в начале: «[102] Сверстать лендинг», с ID задачи клиента —
 * «[102-456] Сверстать лендинг» (#34); длиннее предела — обрезка.
 * Название уже начинается с этой приставки (так иногда называют задачи) — второй раз не добавляем,
 * иначе клиент увидел бы «[102] [102] …» (находка программиста панели).
 */
export function withTaskId(name: string, taskId: number, clientTaskId?: string | null): string {
  const prefix = clientTaskId ? `[${taskId}-${clientTaskId}]` : `[${taskId}]`
  // Приставка этой задачи уже стоит — в любом виде («[102]», «[102-456]», «[102-старый]»): заменяем,
  // а не добавляем вторую — иначе «[102-456] [102] …» (находка /code-review).
  const own = new RegExp(`^\\[${taskId}(?:-[A-Za-z0-9_]{1,30})?\\] ?`)
  // Обрезка — в обеих ветках: функция экспортирована, и сырое название длиннее предела тоже придёт.
  return clampName(`${prefix} ${name.replace(own, '')}`)
}

/**
 * ID задачи в названиях строк, если это включено в настройках (`taskIdInName`). Вызывается
 * последним шагом, после названий от BitrixGPT: предпросмотр и счёт показывают одно и то же.
 */
export function applyTaskIds(rows: DraftRow[], enabled: boolean): DraftRow[] {
  return enabled ? rows.map(row => ({ ...row, name: withTaskId(row.name, row.taskId, row.clientTaskId) })) : rows
}

/**
 * Последний шаг сборки — одна функция для страницы, смока и будущих путей записи («Создать счёт»):
 * сначала названия от BitrixGPT (`names`; `null` — режим «как есть»), потом ID задачи по
 * настройке. Порядок важен: названия от BitrixGPT заменяют название целиком, и ID, добавленный
 * раньше, пропал бы (находка /code-review). Ошибки названий добавляются к ошибкам сборки, а не
 * заменяют их: вызывающий, запросивший названия при ошибках сборки, не получит «ошибок нет» и не
 * запишет счёт с недостающими данными (находка второго круга).
 */
export function finishRows(built: FillResult, names: Record<string, string> | null, taskIdInName: boolean): FillResult {
  const named = names ? applyNames(built.rows, names) : { rows: built.rows, errors: [] }
  return { ...built, rows: applyTaskIds(named.rows, taskIdInName), errors: [...built.errors, ...named.errors] }
}

/**
 * Строка в формате crm.item.productrow.set / .add (поля — по документации метода). Товара
 * каталога нет (#3): позиция — свободная, с названием, ценой и количеством. `price` — цена С
 * налогом (документация: «с учетом скидок и налогов»); `taxIncluded: 'N'` — НДС сверху, портал
 * покажет цену без НДС и налог отдельно. «Без НДС» — налоговых полей нет (портал ставит `taxRate: null`).
 */
export interface ProductRowPayload {
  productName: string
  price: number
  quantity: number
  taxRate?: number
  taxIncluded?: 'N'
  measureCode?: number
  sort: number
}

/** Перевод строк в поля товарных позиций. `sortStart` — чтобы в режиме «добавить» идти после существующих. */
export function toProductRows(rows: DraftRow[], settings: AppSettings, sortStart = 0): ProductRowPayload[] {
  return rows.map((row, i) => ({
    productName: row.name,
    // «Стоимость работ» — итог с налогом как есть: клиент платит ровно записанное.
    price: row.fixedGross ?? grossPrice(row.price, row.taxRate),
    quantity: row.quantity,
    ...(row.taxRate === null ? {} : { taxRate: row.taxRate, taxIncluded: 'N' as const }),
    ...(settings.measureCode ? { measureCode: settings.measureCode } : {}),
    sort: sortStart + (i + 1) * 10
  }))
}
