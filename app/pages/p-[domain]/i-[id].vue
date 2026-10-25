<script setup lang="ts">
// Публичная страница счёта (#34, этап 3): `/p-<домен портала>/i-<ID счёта>` — по QR-коду на счёте.
// Клиент вводит код доступа (поле «Код доступа» его компании или контакта) и видит расшифровку:
// клиент, «моя компания», дата, статус, строки «[123-456] …» с суммами и задачи — заголовок со
// ссылкой, описание, результат; задача клиента — по его вебхуку (этап 4): постановщик, состояние,
// дата принятия, описание и результат; без вебхука — только ссылка. Не в разрешённой стадии —
// спокойная фраза из настроек.
// Без фрейма портала: страница открыта всем, данные отдаёт сервер только по верному коду.
import ObserverIcon from '@bitrix24/b24icons-vue/outline/ObserverIcon'
import CrossedEyeIcon from '@bitrix24/b24icons-vue/outline/CrossedEyeIcon'
import { MAX_COMMENT_LENGTH } from '#shared/domain/approval'
import { pdfFileName, type PublicInvoiceView } from '#shared/domain/publicInvoice'

useHead({ title: 'Документы для счёта', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

// Ночная тема — по системе устройства (страницу открывают с телефона по QR, без портала)
onMounted(() => {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    document.documentElement.classList.toggle('dark', mq.matches)
    document.documentElement.classList.toggle('light', !mq.matches)
  }
  apply()
  mq.addEventListener('change', apply)
})

const route = useRoute()
const domain = computed(() => String(route.params.domain ?? ''))
const invoiceId = computed(() => Number(route.params.id))

const code = ref('')

/** Код показан открытым текстом (кнопка с глазом) — как пример «With password toggle» в b24ui. */
const showCode = ref(false)
const busy = ref(false)
const error = ref('')
const invoice = ref<PublicInvoiceView | null>(null)
const closedText = ref('')

async function open() {
  // Автозаполнение браузера не шлёт input до первого касания — берём значение прямо из поля
  const el = document.getElementById('access-code') as HTMLInputElement | null
  if (el?.value && el.value !== code.value) code.value = el.value
  if (code.value.trim().length !== 10) {
    error.value = 'Код доступа — 10 символов'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const res = await $fetch<{ state: 'open', invoice: PublicInvoiceView } | { state: 'closed', text: string }>('/api/public/invoice', {
      method: 'POST',
      body: { domain: domain.value, invoiceId: invoiceId.value, code: code.value }
    })
    if (res.state === 'open') {
      invoice.value = res.invoice
      void loadPreviews()
    } else closedText.value = res.text
  } catch (e) {
    const err = e as { data?: { error?: string }, statusMessage?: string }
    error.value = err.data?.error || err.statusMessage || 'Не удалось открыть счёт'
  } finally {
    busy.value = false
  }
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: currency || 'RUB' }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

function date(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value
}

const downloading = ref<number | null>(null)
/** Превью документов: ID → адрес картинки (blob). Нет превью — кнопка без картинки. */
const previews = ref<Record<number, string>>({})

/** Картинки документов — параллельно, тем же защищённым путём, что и PDF (код в теле). */
async function loadPreviews() {
  await Promise.all((invoice.value?.documents ?? []).map(async (d) => {
    try {
      const blob = await $fetch<Blob>('/api/public/document', {
        method: 'POST',
        body: { domain: domain.value, invoiceId: invoiceId.value, code: code.value, documentId: d.id, kind: 'image' },
        responseType: 'blob'
      })
      previews.value = { ...previews.value, [d.id]: URL.createObjectURL(blob) }
    } catch {
      // Превью — удобство: без него остаётся кнопка PDF.
    }
  }))
}
const docError = ref('')

/** PDF — POST с кодом в теле (не в адресе), файл — через blob. */
async function download(id: number, title: string) {
  downloading.value = id
  docError.value = ''
  try {
    const blob = await $fetch<Blob>('/api/public/document', {
      method: 'POST',
      body: { domain: domain.value, invoiceId: invoiceId.value, code: code.value, documentId: id },
      responseType: 'blob'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = pdfFileName(title, id)
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (e) {
    // При responseType: 'blob' и тело ошибки — Blob: текст сервера достаём из него.
    const err = e as { data?: unknown, statusMessage?: string }
    let text = ''
    if (err.data instanceof Blob) {
      try {
        text = (JSON.parse(await err.data.text()) as { error?: string }).error ?? ''
      } catch {
        text = ''
      }
    }
    docError.value = text || err.statusMessage || 'Не удалось скачать документ'
  } finally {
    downloading.value = null
  }
}

const commentText = ref('')
const sending = ref(false)
const commentError = ref('')
const commentSent = ref(false)

/** Комментарий в режиме согласования: дело на ответственного; затем перечитываем счёт — список обновится. */
async function sendComment() {
  sending.value = true
  commentError.value = ''
  commentSent.value = false
  try {
    await $fetch('/api/public/comment', {
      method: 'POST',
      body: { domain: domain.value, invoiceId: invoiceId.value, code: code.value, text: commentText.value }
    })
    commentText.value = ''
    commentSent.value = true
    // Перечитывание счёта долгое (задачи, документы) — кнопку не держим: список обновится сам
    void refreshApproval().catch(() => {})
  } catch (e) {
    const err = e as { data?: { error?: string }, statusMessage?: string }
    commentError.value = err.data?.error || err.statusMessage || 'Не удалось отправить комментарий'
  } finally {
    sending.value = false
  }
}

const approving = ref(false)

/** «Согласовать»: галка и дата — в счёт, дело — ответственному; затем перечитываем отметку. */
async function approve() {
  approving.value = true
  commentError.value = ''
  try {
    await $fetch('/api/public/approve', { method: 'POST', body: { domain: domain.value, invoiceId: invoiceId.value, code: code.value } })
    await refreshApproval()
  } catch (e) {
    const err = e as { data?: { error?: string }, statusMessage?: string }
    commentError.value = err.data?.error || err.statusMessage || 'Не удалось отметить согласование'
  } finally {
    approving.value = false
  }
}

async function refreshApproval() {
  const res = await $fetch<{ state: 'open', invoice: PublicInvoiceView } | { state: 'closed', text: string }>('/api/public/invoice', {
    method: 'POST',
    body: { domain: domain.value, invoiceId: invoiceId.value, code: code.value }
  })
  if (res.state === 'open' && invoice.value) invoice.value = { ...invoice.value, approval: res.invoice.approval }
}

/** Решения по задачам; `null` — в счёте нет поля решений (кнопок по задачам нет). */
const decisions = computed(() => invoice.value?.approval?.decisions ?? null)
/** Задачи для решений — под названием строки счёта (как в «Работах»), без строки — название задачи. */
const decisionTasks = computed(() => {
  if (!decisions.value) return []
  const rows = invoice.value?.rows ?? []
  return (invoice.value?.tasks ?? []).map((t) => {
    const row = rows.find(r => r.taskId === t.id)
    return { id: t.id, title: row ? rowTitle(row.name) : t.title }
  })
})
const decisionCount = computed(() => {
  const d = decisions.value ?? {}
  const ids = decisionTasks.value.map(t => t.id)
  return { yes: ids.filter(id => d[id] === 'yes').length, no: ids.filter(id => d[id] === 'no').length, all: ids.length }
})
const deciding = ref(false)

/**
 * Решение по задачам — одной или всем: сразу показываем (оптимистично), сервер пишет в счёт;
 * затем перечитываем — вдруг счёт стал согласованным (все подтверждены). Сбой — откат и текст.
 */
async function decide(map: Record<number, 'yes' | 'no'>) {
  if (!invoice.value?.approval || deciding.value) return
  const before = invoice.value.approval
  invoice.value = { ...invoice.value, approval: { ...before, decisions: { ...(before.decisions ?? {}), ...map } } }
  deciding.value = true
  commentError.value = ''
  try {
    await $fetch('/api/public/decide', { method: 'POST', body: { domain: domain.value, invoiceId: invoiceId.value, code: code.value, decisions: map } })
    void refreshApproval().catch(() => {})
  } catch (e) {
    if (invoice.value) invoice.value = { ...invoice.value, approval: before }
    const err = e as { data?: { error?: string }, statusMessage?: string }
    commentError.value = err.data?.error || err.statusMessage || 'Не удалось сохранить решение'
  } finally {
    deciding.value = false
  }
}
function decideAll(d: 'yes' | 'no') {
  void decide(Object.fromEntries(decisionTasks.value.map(t => [t.id, d])))
}

function dateTime(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

/** Раскрытые строки «Работ»: подробности задачи по нажатию на строку. */
const openRows = ref(new Set<string>())
function toggleRow(value: string) {
  const next = new Set(openRows.value)
  if (!next.delete(value)) next.add(value)
  openRows.value = next
}

const tasksById = computed(() => new Map((invoice.value?.tasks ?? []).map(t => [t.id, t])))

/** Что показать в строке: состояние и дата — задачи клиента, если она прочитана, иначе нашей. */
function rowMeta(task: PublicInvoiceView['tasks'][number] | undefined): { state: string, date: string, done: boolean } {
  const c = task?.clientTask
  if (c) return { state: c.acceptedAt ? 'принята' : c.state, date: c.acceptedAt ?? task?.date ?? '', done: Boolean(c.acceptedAt) }
  return { state: task?.state ?? '', date: task?.date ?? '', done: task?.state === 'принята' }
}

/** Результаты, раскрытые целиком (по умолчанию — первые 6 строк). */
const fullResult = ref(new Set<number>())
function toggleResult(id: number) {
  const next = new Set(fullResult.value)
  if (!next.delete(id)) next.add(id)
  fullResult.value = next
}

/** Строка счёта без приставки «[87-119884] » — для счётчика решений; в «Работах» название как в счёте (владелец 2026-10-25). */
function rowTitle(name: string): string {
  return name.replace(/^\[[^\]]*\]\s*/, '') || name
}

/** Результаты задачи: сначала клиента (его задача — то, что он ставил), затем наши; без дублей. */
function allResults(task: PublicInvoiceView['tasks'][number]): string[] {
  return [...new Set([...(task.clientTask?.results ?? []), ...task.results])]
}
function lastResult(task: PublicInvoiceView['tasks'][number]): string {
  return allResults(task)[0] ?? ''
}

/** Строки счёта — пункты аккордеона: раскрывается задача строки (наша и задача клиента отдельно). */
const rowItems = computed(() => {
  const rows = invoice.value?.rows ?? []
  const items = rows.map((row, i) => {
    const task = row.taskId ? tasksById.value.get(row.taskId) : undefined
    return { value: String(i), row: { name: row.name, sum: row.sum as number | null }, task, disabled: !task, ...rowMeta(task) }
  })
  // Задачи счёта без строки (согласование до сборки строк) — в том же списке, без суммы.
  const inRows = new Set(rows.map(r => r.taskId))
  for (const task of invoice.value?.tasks ?? []) {
    if (!inRows.has(task.id)) items.push({ value: `t${task.id}`, row: { name: task.title, sum: null }, task, disabled: false, ...rowMeta(task) })
  }
  return items.map((item, i) => ({ ...item, n: i + 1 }))
})
</script>

<template>
  <div>
    <!-- Вход — как окно входа Битрикс24: карточка по центру на фоне; телефон — во всю ширину -->
    <div
      v-if="!invoice && !closedText"
      class="hd-login min-h-dvh flex items-center justify-center p-4"
    >
      <form
        v-if="!invoice && !closedText"
        class="hd-card w-full max-w-sm p-6 sm:p-8 space-y-5 shadow-xl"
        data-testid="public-code-form"
        @submit.prevent="open"
      >
        <div class="text-center space-y-1">
          <div class="text-xl">
            Документы для счёта
          </div>
          <div class="text-base opacity-80">
            {{ domain }}
          </div>
        </div>
        <B24FormField
          label="Код доступа"
          description="Код выдаёт ваш менеджер — браузер его запомнит"
          :b24ui="{ label: 'w-full text-center', description: 'text-center' }"
        >
          <!-- Логин для менеджера паролей: домен портала — браузер предложит тот же код на всех счетах. -->
          <input
            :value="domain"
            type="text"
            name="username"
            autocomplete="username"
            readonly
            tabindex="-1"
            aria-hidden="true"
            class="sr-only"
          >
          <B24Input
            id="access-code"
            v-model="code"
            name="password"
            :type="showCode ? 'text' : 'password'"
            autocomplete="current-password"
            maxlength="10"
            size="lg"
            class="w-full font-mono"
            :b24ui="{ trailing: 'pe-1' }"
            aria-label="Код доступа"
            data-testid="public-code"
          >
            <template #trailing>
              <B24Button
                size="md"
                color="air-tertiary-no-accent"
                :icon="showCode ? CrossedEyeIcon : ObserverIcon"
                :aria-label="showCode ? 'Скрыть код' : 'Показать код'"
                :aria-pressed="showCode"
                aria-controls="access-code"
                data-testid="public-code-toggle"
                @click="showCode = !showCode"
              />
            </template>
          </B24Input>
        </B24FormField>
        <B24Button
          type="submit"
          color="air-primary-success"
          size="lg"
          block
          label="Открыть"
          :loading="busy"
          :disabled="busy"
          data-testid="public-open"
        />
        <p
          v-if="error"
          class="text-base text-center text-(--ui-color-accent-main-alert)"
          data-testid="public-error"
        >
          {{ error }}
        </p>
      </form>
    </div>
    <div
      v-else
      class="mx-auto max-w-3xl p-3 sm:p-4 space-y-4 text-base"
    >
      <h1 class="sr-only">
        Документы для счёта
      </h1>

      <B24Alert
        v-if="closedText"
        color="air-secondary"
        :description="closedText"
        data-testid="public-closed"
      />

      <template v-if="invoice">
        <!-- Шапка: что за счёт, сколько и в каком он статусе — видно сразу, без чтения -->
        <section
          class="hd-card p-4 space-y-3"
          data-testid="public-summary"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="space-y-1">
              <div class="text-xl font-semibold leading-tight">
                Документы для счёта №{{ invoice.number || invoiceId }}{{ invoice.date ? ` от ${date(invoice.date)}` : '' }}
              </div>
              <div class="flex flex-wrap items-center gap-2 text-base opacity-80">
                <B24Badge
                  color="air-secondary-accent"
                  size="md"
                  :label="invoice.stage"
                />
              </div>
            </div>
            <div class="w-full sm:w-auto flex sm:block items-baseline justify-between gap-3 sm:text-right border-t sm:border-0 border-(--ui-color-design-plain-content-divider) pt-2 sm:pt-0">
              <div class="text-sm uppercase opacity-75">
                Итого
              </div>
              <div class="text-2xl font-semibold whitespace-nowrap">
                {{ money(invoice.total, invoice.currencyId) }}
              </div>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 text-base">
            <div
              v-if="invoice.myCompany"
              class="rounded-lg bg-(--ui-color-bg-content-secondary) p-3"
            >
              <div class="text-sm opacity-75">
                Исполнитель
              </div>
              <div class="font-medium">
                {{ invoice.myCompany }}
              </div>
            </div>
            <div
              v-if="invoice.company || invoice.contacts.length"
              class="rounded-lg bg-(--ui-color-bg-content-secondary) p-3"
            >
              <div class="text-sm opacity-75">
                Заказчик
              </div>
              <div
                v-if="invoice.company"
                class="font-medium"
              >
                {{ invoice.company }}
              </div>
              <div
                v-if="invoice.contacts.length"
                class="opacity-80"
              >
                {{ invoice.contacts.join(', ') }}
              </div>
            </div>
          </div>
        </section>

        <!-- Согласование одной плашкой, как «Документ прошёл проверку»: галка — согласовано, иначе ждёт -->
        <section
          v-if="invoice.approval"
          class="hd-card p-4 flex flex-wrap items-center gap-3"
          data-testid="public-approval-status"
        >
          <div
            class="size-10 shrink-0 rounded-full flex items-center justify-center text-white text-xl"
            :class="invoice.approval.mark.approved ? 'bg-(--ui-color-accent-main-success)' : 'bg-(--ui-color-accent-main-warning)'"
            aria-hidden="true"
          >
            {{ invoice.approval.mark.approved ? '✓' : '!' }}
          </div>
          <div class="flex-1 min-w-48">
            <div class="font-medium">
              {{ invoice.approval.mark.approved ? 'Счёт согласован' : 'Счёт ждёт вашего согласования' }}
            </div>
            <div class="text-base opacity-80">
              {{ invoice.approval.mark.approved
                ? (invoice.approval.mark.approvedAt ? dateTime(invoice.approval.mark.approvedAt) : '')
                : decisions
                  ? `Отметьте каждую работу ниже или все сразу · подтверждено ${decisionCount.yes} из ${decisionCount.all}${decisionCount.no ? `, не делаем ${decisionCount.no}` : ''}`
                  : 'Всё верно — «Согласовать»; нужно поправить — комментарий ниже' }}
            </div>
          </div>
          <div
            v-if="decisions && decisionTasks.length"
            class="w-full space-y-2"
            data-testid="public-decisions"
          >
            <div class="flex flex-wrap gap-2 pt-2">
              <B24Button
                color="air-primary-success"
                label="Подтвердить всё"
                :loading="deciding"
                :disabled="deciding"
                class="flex-1 sm:flex-none justify-center"
                data-testid="public-decide-all-yes"
                @click="decideAll('yes')"
              />
              <B24Button
                color="air-secondary"
                label="Всё не делаем"
                :disabled="deciding"
                class="flex-1 sm:flex-none justify-center"
                data-testid="public-decide-all-no"
                @click="decideAll('no')"
              />
            </div>
            <p
              v-if="commentError"
              class="text-(--ui-color-accent-main-alert)"
            >
              {{ commentError }}
            </p>
          </div>
          <B24Button
            v-if="!decisions && !invoice.approval.mark.approved && invoice.approval.mark.enabled"
            color="air-primary-success"
            label="Согласовать"
            :loading="approving"
            :disabled="approving"
            class="w-full sm:w-auto justify-center"
            data-testid="public-approve"
            @click="approve"
          />
        </section>

        <section
          v-if="invoice.documents?.length"
          class="space-y-2"
          data-testid="public-documents"
        >
          <div class="text-sm uppercase opacity-75">
            Документы
          </div>
          <div class="flex flex-wrap gap-3">
            <button
              v-for="d in invoice.documents"
              :key="d.id"
              type="button"
              class="hd-card w-36 p-2 space-y-2 text-left hover:shadow-md transition-shadow disabled:opacity-75"
              :aria-label="`Скачать ${d.title} (PDF)`"
              :disabled="downloading !== null"
              data-testid="public-document"
              @click="download(d.id, d.title)"
            >
              <img
                v-if="previews[d.id]"
                :src="previews[d.id]"
                :alt="d.title"
                class="w-full h-auto rounded border border-(--ui-color-design-plain-content-divider) bg-white"
                data-testid="public-document-preview"
              >
              <div
                v-else
                class="w-full aspect-[3/4] rounded bg-(--ui-color-bg-content-secondary) flex items-center justify-center text-sm opacity-75"
              >
                PDF
              </div>
              <div class="text-sm font-medium leading-tight">
                {{ downloading === d.id ? 'Скачиваю…' : d.title }}
              </div>
            </button>
          </div>
          <p
            v-if="docError"
            class="text-base text-(--ui-color-accent-main-alert)"
          >
            {{ docError }}
          </p>
        </section>

        <section class="space-y-2">
          <div class="text-sm uppercase opacity-75">
            Работы
          </div>
          <!-- Строка — чтобы вспомнить: №, что за задача, состояние, дата, цена. Подробности — по раскрытию. -->
          <!-- Решения по работе — прямо в её строке (владелец 2026-10-25: два списка рядом — странно) -->
          <div
            class="hd-card px-3"
            data-testid="public-rows"
          >
            <div
              v-for="item in rowItems"
              :key="item.value"
              class="border-b last:border-b-0 border-(--ui-color-design-plain-content-divider)"
            >
              <!-- Строка: название раскрывает подробности; цена и решения — рядом, видны и в свёрнутом виде -->
              <div class="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 py-3">
                <button
                  type="button"
                  class="grid flex-1 min-w-0 grid-cols-[1.5rem_1fr_auto] items-center gap-3 text-left disabled:cursor-default"
                  :disabled="item.disabled"
                  :aria-expanded="openRows.has(item.value)"
                  data-testid="public-row"
                  @click="toggleRow(item.value)"
                >
                  <span class="text-base opacity-75 tabular-nums">{{ item.n }}</span>
                  <span class="min-w-0">
                    <span class="block text-lg font-medium leading-snug">{{ item.row.name }}</span>
                    <span class="flex flex-wrap items-center gap-2 text-sm opacity-80 mt-0.5">
                      <B24Badge
                        v-if="item.state"
                        :color="item.done ? 'air-primary-success' : 'air-secondary'"
                        size="md"
                        :label="item.state"
                      />
                      <span v-if="item.date">{{ date(item.date) }}</span>
                    </span>
                  </span>
                  <span
                    v-if="!item.disabled"
                    class="opacity-60 transition-transform"
                    :class="{ 'rotate-180': openRows.has(item.value) }"
                    aria-hidden="true"
                  >⌄</span>
                </button>
                <span
                  v-if="item.row.sum !== null"
                  class="whitespace-nowrap text-lg font-semibold tabular-nums pl-9 sm:pl-0"
                >{{ money(item.row.sum, invoice.currencyId) }}</span>
                <span
                  v-else
                  class="whitespace-nowrap text-sm opacity-75 pl-9 sm:pl-0"
                >без строки</span>
                <div
                  v-if="decisions && item.task"
                  class="flex gap-2 shrink-0"
                >
                  <B24Button
                    :color="decisions[item.task.id] === 'yes' ? 'air-primary-success' : 'air-secondary'"
                    size="sm"
                    :label="decisions[item.task.id] === 'yes' ? '✓ Подтверждено' : 'Подтверждаю'"
                    :disabled="deciding"
                    :aria-pressed="decisions[item.task.id] === 'yes'"
                    data-testid="public-decide-yes"
                    @click="decide({ [item.task.id]: 'yes' })"
                  />
                  <B24Button
                    :color="decisions[item.task.id] === 'no' ? 'air-primary-alert' : 'air-secondary'"
                    size="sm"
                    :label="decisions[item.task.id] === 'no' ? '✕ Не делаем' : 'Не делаем'"
                    :disabled="deciding"
                    :aria-pressed="decisions[item.task.id] === 'no'"
                    data-testid="public-decide-no"
                    @click="decide({ [item.task.id]: 'no' })"
                  />
                </div>
              </div>
              <template v-if="openRows.has(item.value)">
                <!-- Как карточка задачи в мобильном Б24: крупно, «Результат работы» карточкой, постановщик с аватаром -->
                <div
                  v-if="item.task"
                  class="space-y-3 text-base pb-3"
                >
                  <div
                    v-if="lastResult(item.task)"
                    class="pub-result p-4 space-y-2"
                    data-testid="public-task"
                  >
                    <div class="flex items-center gap-2 text-lg font-semibold">
                      <span
                        class="size-7 rounded-md border-2 border-(--ui-color-accent-main-primary) text-(--ui-color-accent-main-primary) flex items-center justify-center text-sm"
                        aria-hidden="true"
                      >✓</span>
                      Результат работы
                    </div>
                    <p
                      class="whitespace-pre-line text-lg leading-relaxed break-words"
                      :class="{ 'line-clamp-6': !fullResult.has(item.task.id) }"
                    >
                      {{ lastResult(item.task) }}
                    </p>
                    <button
                      v-if="lastResult(item.task).split('\n').length > 6 || lastResult(item.task).length > 300"
                      type="button"
                      class="underline text-(--ui-color-accent-main-primary)"
                      @click="toggleResult(item.task.id)"
                    >
                      {{ fullResult.has(item.task.id) ? 'Свернуть' : 'Показать полностью' }}
                    </button>
                    <details v-if="allResults(item.task).length > 1">
                      <summary class="cursor-pointer opacity-80">
                        Все результаты ({{ allResults(item.task).length }})
                      </summary>
                      <p
                        v-for="(r, j) in allResults(item.task).slice(1)"
                        :key="j"
                        class="whitespace-pre-line mt-2 pt-2 border-t border-(--ui-color-design-plain-content-divider)"
                      >
                        {{ r }}
                      </p>
                    </details>
                  </div>
                  <div
                    v-else
                    data-testid="public-task"
                  />

                  <!-- Задача исполнителя: её название и описание; описание задачи клиента не показываем (владелец 2026-10-25) -->
                  <div class="pub-tile p-4 space-y-2">
                    <div class="font-medium">
                      {{ item.task.title || item.row.name }}
                    </div>
                    <div
                      v-if="item.task.clientTask?.creatorName"
                      class="flex items-center gap-2 text-sm opacity-80"
                    >
                      <span>Поставил</span>
                      <img
                        v-if="item.task.clientTask.creatorIcon"
                        :src="item.task.clientTask.creatorIcon"
                        alt=""
                        referrerpolicy="no-referrer"
                        class="size-6 rounded-full object-cover"
                      >
                      <span
                        v-else
                        class="size-6 rounded-full bg-(--ui-color-accent-main-primary) text-white text-xs flex items-center justify-center"
                        aria-hidden="true"
                      >{{ item.task.clientTask.creatorName.slice(0, 1) }}</span>
                      <span>{{ item.task.clientTask.creatorName }}</span>
                    </div>
                    <p
                      v-if="item.task.description"
                      class="whitespace-pre-line opacity-90"
                    >
                      {{ item.task.description }}
                    </p>
                    <div class="flex flex-wrap gap-2 pt-1">
                      <B24Button
                        v-if="item.task.clientTaskUrl"
                        :to="item.task.clientTaskUrl"
                        target="_blank"
                        color="air-primary"
                        size="md"
                        :label="`Ваша задача #${item.task.clientTaskId}`"
                        data-testid="public-client-task"
                      />
                      <span
                        v-else-if="item.task.clientTaskId"
                        class="opacity-80"
                        data-testid="public-client-task"
                      >Ваша задача #{{ item.task.clientTaskId }}</span>
                      <B24Button
                        :to="item.task.url"
                        target="_blank"
                        color="air-secondary"
                        size="md"
                        :label="`Задача исполнителя #${item.task.id}`"
                      />
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
          <p
            v-if="invoice.truncated"
            class="text-base opacity-80"
          >
            Показаны первые позиции счёта; итог — по всему счёту.
          </p>
          <div class="flex justify-between px-3 pt-1 text-xl font-semibold">
            <span>Итого</span>
            <span class="tabular-nums">{{ money(invoice.total, invoice.currencyId) }}</span>
          </div>
        </section>

        <section
          v-if="invoice.approval"
          class="hd-card p-4 space-y-3"
          data-testid="public-approval"
        >
          <div class="font-medium">
            {{ invoice.approval.mark.approved ? 'Вопросы по счёту' : 'Есть замечания?' }}
          </div>
          <p class="text-base opacity-80">
            Напишите, что поправить, — менеджер получит задачу и ответит здесь же.
          </p>
          <form
            class="space-y-2"
            @submit.prevent="sendComment"
          >
            <B24Textarea
              v-model="commentText"
              :maxlength="MAX_COMMENT_LENGTH"
              :rows="3"
              class="w-full"
              placeholder="Ваш комментарий"
              aria-label="Комментарий"
              data-testid="public-comment-text"
            />
            <B24Button
              type="submit"
              color="air-primary"
              label="Отправить"
              :loading="sending"
              :disabled="sending || !commentText.trim()"
              data-testid="public-comment-send"
            />
            <p
              v-if="commentError"
              class="text-base text-(--ui-color-accent-main-alert)"
            >
              {{ commentError }}
            </p>
            <p
              v-else-if="commentSent"
              class="text-base text-(--ui-color-accent-main-success)"
            >
              Комментарий отправлен
            </p>
          </form>
          <article
            v-for="c in invoice.approval.comments"
            :key="c.id"
            class="rounded border border-(--ui-color-design-plain-content-divider) p-3 space-y-2 text-base"
            data-testid="public-comment"
          >
            <div class="flex justify-between gap-2 text-sm opacity-80">
              <span>{{ dateTime(c.created) }}</span>
              <B24Badge
                v-if="c.closed"
                color="air-primary-success"
                size="md"
                label="Закрыто"
              />
            </div>
            <p class="whitespace-pre-line">
              {{ c.text }}
            </p>
            <div
              v-if="c.answer"
              class="ml-3 pl-3 border-l-2 border-(--ui-color-accent-main-primary) whitespace-pre-line"
            >
              <b>Ответ:</b> {{ c.answer }}
            </div>
          </article>
        </section>
      </template>
    </div>
  </div>
</template>

<style>
/* Свой глаз у Edge не нужен — есть кнопка (пример b24ui). */
::-ms-reveal {
  display: none;
}

/* Карточка как в «Документ на подпись»: белая, скруглённая, с мягкой тенью */
.hd-card {
  background: var(--ui-color-bg-content-primary, #fff);
  border: 1px solid var(--ui-color-design-plain-content-divider, rgb(0 0 0 / 0.08));
  border-radius: 14px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.05);
}

/* Карточки раскрытой задачи — как в мобильном Б24 */
.pub-result {
  border: 2px solid var(--ui-color-accent-main-primary, #2066b0);
  border-radius: 18px;
  background: var(--ui-color-bg-content-primary, #fff);
}
.pub-tile {
  border-radius: 18px;
  background: var(--ui-color-bg-content-secondary, #f5f7f8);
}

/* Фон входа — мягкий градиент Б24 (без фото: страница лёгкая и на телефоне); ночью — тёмный */
.hd-login {
  background: linear-gradient(135deg, #2fc6f6 0%, #1f8fd8 45%, #12b97f 100%);
}
.dark .hd-login {
  background: linear-gradient(135deg, #0b2a3d 0%, #0d1f33 50%, #0b2e25 100%);
}
</style>
