<script setup lang="ts">
// Поле «Экономика счёта» (свой тип, решение владельца 2026-10-07) в карточке счёта: значение —
// JSON итога (economics.ts → invoiceEconomy), здесь — сводка: выставлено, по формуле, дельта,
// прибыль или убыток, задачи с пометками. «Пересчитать» спрашивает, откуда брать задачи и как
// считать, и прогоняет тот же сбор, что «Заполнить из задач» (строки в счёт НЕ пишет): поля задач и
// это поле обновляются правами сотрудника.
import type { FillMode, TaskSource } from '#shared/domain/fill'
import { parseInvoiceEconomy, type InvoiceEconomy } from '#shared/domain/economics'
import { camelFieldKey } from '#shared/domain/userFields'
import { publicInvoiceUrl, publicQrUrl } from '#shared/domain/invoiceLinks'
import { formatMoney } from '~/utils/fillPreview'
import { fieldContext, type FieldContext } from '~/utils/fieldPlacement'

const b24 = useB24()
const app = useAppSettings()
const fill = useInvoiceFill()

const ctx = ref<FieldContext | null>(null)
const econ = ref<InvoiceEconomy | null>(null)
const origin = ref('')
const asking = ref(false)
const busy = ref(false)
const error = ref('')
// Задачи — только привязанные к счёту (вариант «из сделки» убран, владелец 2026-10-09)
const source: TaskSource = 'invoice'
const mode = ref<FillMode>('task')
const expanded = ref(false)
const config = useRuntimeConfig()
/** Ссылки расшифровки и картинки QR — считаем из домена и ID счёта, в поля не пишем (владелец 2026-10-09). */
const links = ref<{ page: string, qr: string } | null>(null)
/** Отметка «Согласовано клиентом» и её дата — из скрытых полей счёта (настройки публичной страницы). */
const approval = ref<{ approved: boolean, at: string } | null>(null)

const modeItems = [
  { label: 'Задача — одна строка', value: 'task' },
  { label: 'Записи времени — строки', value: 'time' }
]

onMounted(async () => {
  const frame = await b24.init()
  if (!frame) return
  origin.value = frame.getTargetOrigin()
  ctx.value = fieldContext(frame.placement.options)
  econ.value = parseInvoiceEconomy(ctx.value.value)
  if (econ.value) {
    mode.value = econ.value.mode
  }
  const id = ctx.value.itemId
  if (id && ctx.value.entityTypeId === 31) {
    const site = config.public.siteUrl || window.location.origin
    const portal = new URL(origin.value).hostname
    links.value = { page: publicInvoiceUrl(site, portal, id), qr: publicQrUrl(site, portal, id) }
    void loadApproval(id)
  }
})

const verdict = computed(() => {
  const e = econ.value
  if (!e) return null
  if (e.verdict === 'profit') return { label: 'Прибыльно', color: 'air-primary-success' as const }
  if (e.verdict === 'loss') return { label: 'Убыточно', color: 'air-primary-alert' as const }
  return { label: 'В ноль', color: 'air-secondary' as const }
})
/** Полосы «выставлено / по формуле»: ширина — доля от большей суммы. */
const bars = computed(() => {
  const e = econ.value
  if (!e) return []
  const max = Math.max(e.billed, e.formula, 0.01)
  return [
    { label: 'Выставлено', value: e.billed, width: Math.round(e.billed / max * 100), color: e.billed < e.formula ? 'bg-(--ui-color-accent-main-alert)' : 'bg-(--ui-color-accent-main-success)' },
    { label: 'По формуле', value: e.formula, width: Math.round(e.formula / max * 100), color: 'bg-(--ui-color-accent-main-primary)' }
  ]
})

const copied = ref(false)
async function copyQr() {
  if (!links.value) return
  try {
    await navigator.clipboard.writeText(links.value.qr)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    window.open(links.value.qr, '_blank', 'noopener')
  }
}

const flagged = computed(() => econ.value?.tasks.filter(t => t.flag) ?? [])

async function loadApproval(id: number) {
  try {
    await app.load()
    const { approvedField, approvedAtField } = app.settings.value.publicPage
    if (!approvedField && !approvedAtField) return
    const res = await b24.call<{ item?: Record<string, unknown> }>('crm.item.get', { entityTypeId: 31, id })
    const item = res?.item ?? {}
    const flag = approvedField ? item[camelFieldKey(approvedField)] : undefined
    const at = approvedAtField ? item[camelFieldKey(approvedAtField)] : undefined
    approval.value = { approved: flag === true || flag === 'Y' || flag === 1 || flag === '1', at: typeof at === 'string' ? at : '' }
  } catch {
    // не прочитали — блок согласования просто не показываем
  }
}

/** Пересчёт: тот же сбор, что в окне счёта, — он сам пишет поля задач и это поле (saveEconomics). */
async function recalc() {
  if (!ctx.value?.itemId || ctx.value.entityTypeId !== 31) {
    error.value = 'Пересчитать можно в сохранённом счёте'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await app.load()
    // Пишем в то поле, в котором открыт виджет (владелец 2026-10-07: настройку не выбрали — а
    // поле-то вот оно). Настройка — для «Собрать строки» в окне счёта.
    const field = ctx.value.fieldName || app.settings.value.economics.invoiceField
    if (!field) throw new Error('Не удалось определить поле «Экономика счёта»')
    app.settings.value.economics.invoiceField = field
    await fill.loadInvoice(ctx.value.itemId)
    await fill.collect(source, mode.value)
    if (fill.error.value || fill.problems.value.length) throw new Error(fill.error.value || fill.problems.value.join('; '))
    const res = await b24.call<{ item?: Record<string, unknown> }>('crm.item.get', { entityTypeId: 31, id: ctx.value.itemId })
    econ.value = parseInvoiceEconomy(res?.item?.[camelFieldKey(field)]) ?? econ.value
    asking.value = false
    if (fill.economyNotice.value) error.value = fill.economyNotice.value
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function signed(v: number): string {
  return `${v > 0 ? '+' : ''}${formatMoney(v)}`
}
function pct(v: number | null): string {
  return v === null ? '' : ` (${v > 0 ? '+' : ''}${v.toLocaleString('ru-RU')}%)`
}
function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}
</script>

<template>
  <div
    class="p-2 text-sm space-y-2"
    data-testid="economics-field"
  >
    <div class="flex flex-wrap gap-3">
      <!-- QR и ссылки: картинка — та же, что подставит шаблон документа -->
      <div
        v-if="links"
        class="ec-card p-2 flex flex-col items-center gap-1 w-32"
      >
        <a
          :href="links.page"
          target="_blank"
          rel="noopener"
          title="Открыть расшифровку"
        >
          <img
            :src="links.qr"
            alt="QR-код расшифровки"
            class="size-24 rounded bg-white p-1"
            data-testid="economics-qr"
          >
        </a>
        <a
          :href="links.page"
          target="_blank"
          rel="noopener"
          class="text-xs underline"
        >Расшифровка</a>
        <button
          type="button"
          class="text-xs underline opacity-70"
          :title="links.qr"
          @click="copyQr"
        >
          {{ copied ? 'Скопировано' : 'Адрес картинки' }}
        </button>
      </div>

      <div class="flex-1 min-w-56 space-y-2">
        <div
          v-if="approval"
          class="flex items-center gap-2"
          data-testid="economics-approval"
        >
          <span
            class="size-5 rounded-full flex items-center justify-center text-white text-xs"
            :class="approval.approved ? 'bg-(--ui-color-accent-main-success)' : 'bg-(--ui-color-accent-main-warning)'"
            aria-hidden="true"
          >{{ approval.approved ? '✓' : '…' }}</span>
          <span>{{ approval.approved ? `Согласовано клиентом${approval.at ? `, ${when(approval.at)}` : ''}` : 'Клиент ещё не согласовал' }}</span>
        </div>

        <template v-if="econ">
          <div class="flex flex-wrap items-center gap-2">
            <B24Badge
              v-if="verdict"
              :color="verdict.color"
              :label="verdict.label"
              data-testid="economics-verdict"
            />
            <span
              class="text-lg font-semibold tabular-nums"
              :class="econ.delta < 0 ? 'text-(--ui-color-accent-main-alert)' : econ.delta > 0 ? 'text-(--ui-color-accent-main-success)' : ''"
            >{{ signed(econ.delta) }} {{ econ.currency }}{{ pct(econ.diffPercent) }}</span>
          </div>
          <!-- Полосы: выставлено против формулы — длина от большего -->
          <div class="space-y-1 max-w-md">
            <div
              v-for="bar in bars"
              :key="bar.label"
              class="grid grid-cols-[6rem_1fr_auto] items-center gap-2"
            >
              <span class="opacity-70">{{ bar.label }}</span>
              <span class="h-2.5 rounded-full bg-(--ui-color-bg-content-secondary) overflow-hidden">
                <span
                  class="block h-full rounded-full"
                  :class="bar.color"
                  :style="{ width: `${bar.width}%` }"
                />
              </span>
              <span class="text-right tabular-nums">{{ formatMoney(bar.value) }}</span>
            </div>
          </div>
          <div class="flex flex-wrap gap-1">
            <B24Badge
              v-if="econ.counts.loss"
              color="air-primary-alert"
              size="xs"
              :label="`убыток: ${econ.counts.loss}`"
            />
            <B24Badge
              v-if="econ.counts.over"
              color="air-primary-warning"
              size="xs"
              :label="`завышение: ${econ.counts.over}`"
            />
            <B24Badge
              v-if="econ.counts.missing"
              color="air-secondary"
              size="xs"
              :label="`нет данных: ${econ.counts.missing}`"
            />
          </div>
          <button
            v-if="flagged.length"
            type="button"
            class="text-xs underline opacity-80"
            @click="expanded = !expanded"
          >
            {{ expanded ? 'Скрыть задачи' : `Задачи с пометками (${flagged.length})` }}
          </button>
          <ul
            v-if="expanded"
            class="space-y-0.5"
          >
            <li
              v-for="t in flagged"
              :key="t.taskId"
            >
              <InvoiceTaskLink
                :origin="origin"
                :task-id="t.taskId"
              />
              {{ t.title }} —
              <span :class="t.delta < 0 ? 'text-(--ui-color-accent-main-alert)' : 'text-(--ui-color-accent-main-success)'">{{ signed(t.delta) }}{{ pct(t.diffPercent) }}</span>
            </li>
          </ul>
          <div class="text-xs opacity-60">
            Посчитано {{ when(econ.at) }} · порог {{ econ.threshold }}%
          </div>
        </template>
        <div
          v-else
          class="opacity-70"
        >
          Экономика ещё не посчитана
        </div>
      </div>
    </div>
    <details class="text-xs opacity-70">
      <summary class="cursor-pointer">
        Как считается
      </summary>
      <p class="mt-1">
        По каждой задаче, привязанной к счёту: <b>по формуле</b> — часы × ставка сотрудника + наценка,
        с НДС (без времени — часы оценивает ИИ); <b>выставлено</b> — сумма строки этой задачи в счёте
        с НДС. <b>Дельта</b> = выставлено − по формуле, <b>разница</b> — дельта в % от формулы.
        Пометки: «убыток» — выставлено меньше формулы больше чем на порог, «завышение» — больше на
        порог, «нет данных» — часы оценил ИИ или сравнить не с чем. Считается при «Собрать строки» в окне счёта
        или кнопкой здесь.
      </p>
    </details>

    <div
      v-if="asking"
      class="flex flex-wrap items-end gap-2"
    >
      <B24Select
        v-model="mode"
        :items="modeItems"
        value-key="value"
        size="sm"
        class="w-56"
        aria-label="Как считать"
      />
      <B24Button
        size="sm"
        color="air-primary"
        label="Посчитать"
        :loading="busy"
        :disabled="busy"
        data-testid="economics-run"
        @click="recalc"
      />
    </div>
    <B24Button
      v-else
      size="xs"
      color="air-secondary"
      :label="econ ? 'Пересчитать' : 'Посчитать'"
      data-testid="economics-recalc"
      @click="asking = true"
    />
    <p
      v-if="error"
      class="text-(--ui-color-accent-main-alert)"
    >
      {{ error }}
    </p>
  </div>
</template>

<style>
.ec-card {
  background: var(--ui-color-bg-content-primary, #fff);
  border: 1px solid var(--ui-color-design-plain-content-divider, rgb(0 0 0 / 0.08));
  border-radius: 12px;
}
</style>
