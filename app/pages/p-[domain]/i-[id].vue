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

function dateTime(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

const tasksById = computed(() => new Map((invoice.value?.tasks ?? []).map(t => [t.id, t])))

/** Что показать в строке: состояние и дата — задачи клиента, если она прочитана, иначе нашей. */
function rowMeta(task: PublicInvoiceView['tasks'][number] | undefined): { state: string, date: string, done: boolean } {
  const c = task?.clientTask
  if (c) return { state: c.acceptedAt ? 'принята' : c.state, date: c.acceptedAt ?? task?.date ?? '', done: Boolean(c.acceptedAt) }
  return { state: task?.state ?? '', date: task?.date ?? '', done: task?.state === 'принята' }
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
          <div class="text-sm opacity-70">
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
                size="sm"
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
          :disabled="busy || code.trim().length !== 10"
          data-testid="public-open"
        />
        <p
          v-if="error"
          class="text-sm text-center text-(--ui-color-accent-main-alert)"
          data-testid="public-error"
        >
          {{ error }}
        </p>
      </form>
    </div>
    <div
      v-else
      class="mx-auto max-w-3xl p-3 sm:p-4 space-y-4"
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
              <div class="text-lg font-semibold leading-tight">
                Документы для счёта №{{ invoice.number || invoiceId }}{{ invoice.date ? ` от ${date(invoice.date)}` : '' }}
              </div>
              <div class="flex flex-wrap items-center gap-2 text-sm opacity-80">
                <B24Badge
                  color="air-secondary-accent"
                  size="sm"
                  :label="invoice.stage"
                />
              </div>
            </div>
            <div class="text-right">
              <div class="text-xs uppercase opacity-60">
                Итого
              </div>
              <div class="text-2xl font-semibold whitespace-nowrap">
                {{ money(invoice.total, invoice.currencyId) }}
              </div>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 text-sm">
            <div
              v-if="invoice.myCompany"
              class="rounded-lg bg-(--ui-color-bg-content-secondary) p-3"
            >
              <div class="text-xs opacity-60">
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
              <div class="text-xs opacity-60">
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
            <div class="text-sm opacity-70">
              {{ invoice.approval.mark.approved
                ? (invoice.approval.mark.approvedAt ? dateTime(invoice.approval.mark.approvedAt) : '')
                : 'Всё верно — «Согласовать»; нужно поправить — комментарий ниже' }}
            </div>
          </div>
          <B24Button
            v-if="!invoice.approval.mark.approved && invoice.approval.mark.enabled"
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
          <div class="text-xs uppercase opacity-60">
            Документы
          </div>
          <div class="flex flex-wrap gap-3">
            <button
              v-for="d in invoice.documents"
              :key="d.id"
              type="button"
              class="hd-card w-36 p-2 space-y-2 text-left hover:shadow-md transition-shadow disabled:opacity-60"
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
                class="w-full aspect-[3/4] rounded bg-(--ui-color-bg-content-secondary) flex items-center justify-center text-xs opacity-60"
              >
                PDF
              </div>
              <div class="text-xs font-medium leading-tight">
                {{ downloading === d.id ? 'Скачиваю…' : d.title }}
              </div>
            </button>
          </div>
          <p
            v-if="docError"
            class="text-sm text-(--ui-color-accent-main-alert)"
          >
            {{ docError }}
          </p>
        </section>

        <section class="space-y-2">
          <div class="text-xs uppercase opacity-60">
            Работы
          </div>
          <!-- Строка — чтобы вспомнить: №, что за задача, состояние, дата, цена. Подробности — по раскрытию. -->
          <B24Accordion
            type="multiple"
            :items="rowItems"
            class="hd-card px-3"
            :b24ui="{ trigger: 'items-center', label: 'flex-1 min-w-0' }"
            data-testid="public-rows"
          >
            <template #default="{ item }">
              <div
                class="grid flex-1 min-w-0 grid-cols-[1.5rem_1fr_auto] items-center gap-3 text-left"
                data-testid="public-row"
              >
                <span class="text-sm opacity-50 tabular-nums">{{ item.n }}</span>
                <span class="min-w-0">
                  <span class="block font-medium leading-snug">{{ item.task?.title || item.row.name }}</span>
                  <span class="flex flex-wrap items-center gap-2 text-xs opacity-70 mt-0.5">
                    <B24Badge
                      v-if="item.state"
                      :color="item.done ? 'air-primary-success' : 'air-secondary'"
                      size="xs"
                      :label="item.state"
                    />
                    <span v-if="item.date">{{ date(item.date) }}</span>
                    <span v-if="item.task">#{{ item.task.id }}</span>
                  </span>
                </span>
                <span
                  v-if="item.row.sum !== null"
                  class="whitespace-nowrap font-semibold tabular-nums"
                >{{ money(item.row.sum, invoice.currencyId) }}</span>
                <span
                  v-else
                  class="whitespace-nowrap text-xs opacity-60"
                >без строки</span>
              </div>
            </template>
            <template #body="{ item }">
              <div
                v-if="item.task"
                class="space-y-3 text-sm pb-2"
              >
                <div
                  class="space-y-1"
                  data-testid="public-task"
                >
                  <div class="text-xs opacity-60">
                    В счёте: {{ item.row.name }}
                  </div>
                  <a
                    :href="item.task.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline"
                  >Задача исполнителя #{{ item.task.id }}</a>
                  <details v-if="item.task.results.length">
                    <summary class="cursor-pointer text-xs opacity-70">
                      Результат{{ item.task.results.length > 1 ? ` (${item.task.results.length})` : '' }}
                    </summary>
                    <p
                      v-for="(r, j) in item.task.results"
                      :key="j"
                      class="whitespace-pre-line mt-1 pl-2 border-l-2 border-(--ui-color-design-plain-content-divider)"
                    >
                      {{ r }}
                    </p>
                  </details>
                  <details v-if="item.task.description">
                    <summary class="cursor-pointer text-xs opacity-70">
                      Описание задачи
                    </summary>
                    <p class="whitespace-pre-line opacity-80 mt-1">
                      {{ item.task.description }}
                    </p>
                  </details>
                </div>
                <div
                  v-if="item.task.clientTaskId"
                  class="rounded-lg bg-(--ui-color-bg-content-secondary) p-3 space-y-1"
                  data-testid="public-client-task"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-xs opacity-60">Ваша задача</span>
                    <a
                      v-if="item.task.clientTaskUrl"
                      :href="item.task.clientTaskUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="underline font-medium"
                    >#{{ item.task.clientTaskId }}</a>
                    <span v-else>#{{ item.task.clientTaskId }}</span>
                    <B24Badge
                      v-if="item.task.clientTask"
                      :color="item.task.clientTask.acceptedAt ? 'air-primary-success' : 'air-secondary'"
                      size="xs"
                      :label="item.task.clientTask.acceptedAt ? `принята ${date(item.task.clientTask.acceptedAt)}` : item.task.clientTask.state"
                    />
                  </div>
                  <template v-if="item.task.clientTask">
                    <div class="font-medium">
                      {{ item.task.clientTask.title }}
                    </div>
                    <div class="flex items-center gap-2 text-xs opacity-80">
                      <img
                        v-if="item.task.clientTask.creatorIcon"
                        :src="item.task.clientTask.creatorIcon"
                        alt=""
                        referrerpolicy="no-referrer"
                        class="size-5 rounded-full object-cover"
                      >
                      <span>Поставил: {{ item.task.clientTask.creatorName || '—' }}</span>
                    </div>
                    <details v-if="item.task.clientTask.results.length">
                      <summary class="cursor-pointer text-xs opacity-70">
                        Результат{{ item.task.clientTask.results.length > 1 ? ` (${item.task.clientTask.results.length})` : '' }}
                      </summary>
                      <p
                        v-for="(r, k) in item.task.clientTask.results"
                        :key="k"
                        class="whitespace-pre-line mt-1 pl-2 border-l-2 border-(--ui-color-design-plain-content-divider)"
                      >
                        {{ r }}
                      </p>
                    </details>
                    <details v-if="item.task.clientTask.description">
                      <summary class="cursor-pointer text-xs opacity-70">
                        Описание задачи
                      </summary>
                      <p class="whitespace-pre-line opacity-80 mt-1">
                        {{ item.task.clientTask.description }}
                      </p>
                    </details>
                  </template>
                </div>
              </div>
            </template>
          </B24Accordion>
          <p
            v-if="invoice.truncated"
            class="text-sm opacity-70"
          >
            Показаны первые позиции счёта; итог — по всему счёту.
          </p>
          <div class="flex justify-between px-3 pt-1 font-semibold">
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
          <p class="text-sm opacity-70">
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
              class="text-sm text-(--ui-color-accent-main-alert)"
            >
              {{ commentError }}
            </p>
            <p
              v-else-if="commentSent"
              class="text-sm text-(--ui-color-accent-main-success)"
            >
              Комментарий отправлен
            </p>
          </form>
          <article
            v-for="c in invoice.approval.comments"
            :key="c.id"
            class="rounded border border-(--ui-color-design-plain-content-divider) p-3 space-y-2 text-sm"
            data-testid="public-comment"
          >
            <div class="flex justify-between gap-2 text-xs opacity-70">
              <span>{{ dateTime(c.created) }}</span>
              <B24Badge
                v-if="c.closed"
                color="air-primary-success"
                size="sm"
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

/* Фон входа — мягкий градиент Б24 (без фото: страница лёгкая и на телефоне); ночью — тёмный */
.hd-login {
  background: linear-gradient(135deg, #2fc6f6 0%, #1f8fd8 45%, #12b97f 100%);
}
.dark .hd-login {
  background: linear-gradient(135deg, #0b2a3d 0%, #0d1f33 50%, #0b2e25 100%);
}
</style>
