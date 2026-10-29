<script setup lang="ts">
// Вид — дизайн v2 (раздел 1): QR слева, справа — согласие, сумма с дельтой, две тонкие полоски,
// пометки и «Пересчитать» тихой ссылкой. Только просмотр, ~120 px.
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
const qrOpen = ref(false)
/** Пилюля дельты: «−204,60 · −4,7%», в ноль — «в ноль». */
const deltaLabel = computed(() => {
  const e = econ.value
  if (!e || e.verdict === 'even') return 'в ноль'
  return `${signed(e.delta)}${e.diffPercent === null ? '' : ` · ${e.diffPercent > 0 ? '+' : ''}${e.diffPercent.toLocaleString('ru-RU')}%`}`
})
function tasksWord(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'задача'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'задачи'
  return 'задач'
}
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
    class="p-2 text-sm"
    data-testid="economics-field"
  >
    <div
      v-if="econ"
      class="flex gap-4"
    >
      <div
        v-if="links"
        class="flex flex-col items-center gap-1 shrink-0"
      >
        <button
          type="button"
          class="ec-qr"
          title="Показать крупно"
          @click="qrOpen = true"
        >
          <img
            :src="links.qr"
            alt="QR-код расшифровки"
            class="size-[84px]"
            data-testid="economics-qr"
          >
        </button>
        <a
          :href="links.page"
          target="_blank"
          rel="noopener"
          class="text-xs ec-muted hover:underline"
        >Расшифровка</a>
      </div>

      <div class="flex-1 min-w-0 space-y-1.5">
        <div
          v-if="approval"
          class="flex flex-wrap items-center gap-2"
          data-testid="economics-approval"
        >
          <B24Badge
            :color="approval.approved ? 'air-primary-success' : 'air-primary-warning'"
            :label="approval.approved ? 'Согласовано клиентом' : 'Клиент ещё не согласовал'"
          />
          <span
            v-if="approval.approved && approval.at"
            class="text-xs ec-muted"
          >{{ when(approval.at) }}</span>
        </div>

        <div class="flex flex-wrap items-baseline gap-2">
          <span class="text-xl font-semibold tabular-nums">{{ formatMoney(econ.billed) }}</span>
          <span class="text-xs ec-muted">{{ econ.currency }}</span>
          <B24Badge
            v-if="verdict"
            :color="verdict.color"
            :label="deltaLabel"
            data-testid="economics-verdict"
          />
        </div>

        <!-- Полоски «выставлено / по формуле»: длина от большего -->
        <div class="space-y-1 max-w-sm">
          <div
            v-for="bar in bars"
            :key="bar.label"
            class="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2"
          >
            <span class="ec-muted">{{ bar.label }}</span>
            <span class="h-1.5 rounded-full bg-(--ui-color-bg-content-tertiary) overflow-hidden">
              <span
                class="block h-full rounded-full"
                :class="bar.color"
                :style="{ width: `${bar.width}%` }"
              />
            </span>
            <span class="text-right tabular-nums">{{ formatMoney(bar.value) }}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <button
            v-if="flagged.length"
            type="button"
            class="hover:underline"
            @click="expanded = !expanded"
          >
            ⚑ {{ flagged.length }} {{ tasksWord(flagged.length) }} с пометками
          </button>
          <span
            v-else
            class="ec-muted"
          >Пометок нет</span>
          <B24Popover v-model:open="asking">
            <button
              type="button"
              class="ec-link"
              data-testid="economics-recalc"
            >
              Пересчитать
            </button>
            <template #content>
              <div class="p-3 space-y-2 w-64">
                <B24Select
                  v-model="mode"
                  :items="modeItems"
                  value-key="value"
                  size="sm"
                  class="w-full"
                  aria-label="Как считать"
                />
                <B24Button
                  size="sm"
                  color="air-primary"
                  label="Посчитать"
                  block
                  :loading="busy"
                  :disabled="busy"
                  data-testid="economics-run"
                  @click="recalc"
                />
              </div>
            </template>
          </B24Popover>
          <span class="ec-muted">посчитано {{ when(econ.at) }}</span>
        </div>
        <ul
          v-if="expanded"
          class="space-y-0.5 text-xs"
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
      </div>
    </div>

    <!-- Пусто: пунктирная рамка и тихая ссылка -->
    <div
      v-else
      class="ec-empty"
    >
      Экономики пока нет. Откройте счёт и нажмите «Собрать строки» — или
      <B24Popover v-model:open="asking">
        <button
          type="button"
          class="ec-link"
          data-testid="economics-recalc"
        >
          пересчитать здесь
        </button>
        <template #content>
          <div class="p-3 space-y-2 w-64">
            <B24Select
              v-model="mode"
              :items="modeItems"
              value-key="value"
              size="sm"
              class="w-full"
              aria-label="Как считать"
            />
            <B24Button
              size="sm"
              color="air-primary"
              label="Посчитать"
              block
              :loading="busy"
              :disabled="busy"
              data-testid="economics-run"
              @click="recalc"
            />
          </div>
        </template>
      </B24Popover>.
    </div>

    <p
      v-if="error"
      class="mt-1 text-xs text-(--ui-color-accent-main-alert)"
    >
      {{ error }}
    </p>

    <B24Modal
      v-if="links"
      v-model:open="qrOpen"
      title="QR-код расшифровки"
    >
      <template #body>
        <div class="flex flex-col items-center gap-3 pb-2">
          <img
            :src="links.qr"
            alt="QR-код расшифровки"
            class="size-64"
          >
          <B24Button
            color="air-secondary"
            :label="copied ? 'Скопировано' : 'Скопировать ссылку'"
            @click="copyQr"
          />
        </div>
      </template>
    </B24Modal>
  </div>
</template>

<style>
.ec-qr {
  padding: 4px;
  border-radius: 12px;
  border: 1px solid var(--tai-border, rgb(0 0 0 / 0.08));
  background: #fff;
}
.ec-muted {
  color: var(--tai-text-3, #5e5e68);
}
.ec-link {
  color: var(--tai-accent, #4b3cd0);
}
.ec-link:hover {
  text-decoration: underline;
}
.ec-empty {
  border: 1px dashed var(--tai-border-dash, #b8b4c4);
  border-radius: 12px;
  padding: 14px 16px;
  text-align: center;
  color: var(--tai-text-2, #45454c);
}
</style>
