<script setup lang="ts">
// Публичная страница счёта (#34, этап 3): `/p-<домен портала>/i-<ID счёта>` — по QR-коду на счёте.
// Клиент вводит код доступа (поле «Код доступа» его компании или контакта) и видит расшифровку:
// клиент, «моя компания», дата, статус, строки «[123-456] …» с суммами и задачи — заголовок со
// ссылкой, описание, результат; задача клиента — по его вебхуку (этап 4): постановщик, состояние,
// дата принятия, описание и результат; без вебхука — только ссылка. Не в разрешённой стадии —
// спокойная фраза из настроек.
// Без фрейма портала: страница открыта всем, данные отдаёт сервер только по верному коду.
import { pdfFileName, type PublicInvoiceView } from '#shared/domain/publicInvoice'

useHead({ title: 'Расшифровка счёта', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

const route = useRoute()
const domain = computed(() => String(route.params.domain ?? ''))
const invoiceId = computed(() => Number(route.params.id))

const code = ref('')
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

/** Картинки документов — по одному запросу, тем же защищённым путём, что и PDF (код в теле). */
async function loadPreviews() {
  for (const d of invoice.value?.documents ?? []) {
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
  }
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

const tasksById = computed(() => new Map((invoice.value?.tasks ?? []).map(t => [t.id, t])))

/** Строки счёта — пункты аккордеона: раскрывается задача строки (наша и задача клиента отдельно). */
const rowItems = computed(() => (invoice.value?.rows ?? []).map((row, i) => {
  const task = row.taskId ? tasksById.value.get(row.taskId) : undefined
  return { value: String(i), row, task, disabled: !task }
}))
</script>

<template>
  <div class="mx-auto max-w-3xl p-4 space-y-6">
    <h1 class="text-xl font-semibold">
      Расшифровка счёта
    </h1>

    <form
      v-if="!invoice && !closedText"
      class="space-y-3"
      data-testid="public-code-form"
      @submit.prevent="open"
    >
      <B24FormField
        label="Код доступа"
        description="Код выдаёт ваш менеджер"
      >
        <B24Input
          v-model="code"
          autocomplete="off"
          maxlength="10"
          class="w-60 font-mono"
          aria-label="Код доступа"
          data-testid="public-code"
        />
      </B24FormField>
      <B24Button
        type="submit"
        color="air-primary"
        label="Открыть"
        :loading="busy"
        :disabled="busy || code.trim().length !== 10"
        data-testid="public-open"
      />
      <p
        v-if="error"
        class="text-sm text-(--ui-color-accent-main-alert)"
        data-testid="public-error"
      >
        {{ error }}
      </p>
    </form>

    <B24Alert
      v-if="closedText"
      color="air-secondary"
      :description="closedText"
      data-testid="public-closed"
    />

    <template v-if="invoice">
      <section class="space-y-1 text-sm">
        <div class="text-lg font-medium">
          {{ invoice.title }}
        </div>
        <div v-if="invoice.company">
          Клиент: {{ invoice.company }}
        </div>
        <div v-if="invoice.contacts.length">
          Контакт: {{ invoice.contacts.join(', ') }}
        </div>
        <div v-if="invoice.myCompany">
          Исполнитель: {{ invoice.myCompany }}
        </div>
        <div v-if="invoice.date">
          Дата выставления: {{ date(invoice.date) }}
        </div>
        <div>Статус: {{ invoice.stage }}</div>
      </section>

      <section
        v-if="invoice.documents?.length"
        class="space-y-2"
        data-testid="public-documents"
      >
        <div class="font-medium">
          Документы
        </div>
        <div class="flex flex-wrap gap-3">
          <div
            v-for="d in invoice.documents"
            :key="d.id"
            class="w-40 space-y-2"
          >
            <button
              v-if="previews[d.id]"
              type="button"
              class="block w-full border border-(--ui-color-divider-less) rounded overflow-hidden bg-white"
              :aria-label="`Скачать ${d.title} (PDF)`"
              :disabled="downloading !== null"
              @click="download(d.id, d.title)"
            >
              <img
                :src="previews[d.id]"
                :alt="d.title"
                class="w-full h-auto"
                data-testid="public-document-preview"
              >
            </button>
            <B24Button
              color="air-secondary"
              size="sm"
              class="w-full justify-center"
              :label="`${d.title} (PDF)`"
              :loading="downloading === d.id"
              :disabled="downloading !== null"
              @click="download(d.id, d.title)"
            />
          </div>
        </div>
        <p
          v-if="docError"
          class="text-sm text-(--ui-color-accent-main-alert)"
        >
          {{ docError }}
        </p>
      </section>

      <section class="space-y-4">
        <B24Accordion
          type="multiple"
          :items="rowItems"
          :b24ui="{ trigger: 'items-start' }"
          data-testid="public-rows"
        >
          <template #default="{ item }">
            <div
              class="flex w-full justify-between gap-3 font-medium text-left"
              data-testid="public-row"
            >
              <span>{{ item.row.name }}</span>
              <span class="whitespace-nowrap">{{ money(item.row.sum, invoice.currencyId) }}</span>
            </div>
          </template>
          <template #body="{ item }">
            <div
              v-if="item.task"
              class="space-y-3 text-sm"
            >
              <div
                class="rounded border border-(--ui-color-divider-less) p-3 space-y-1"
                data-testid="public-task"
              >
                <div class="text-xs uppercase opacity-60">
                  Задача исполнителя
                </div>
                <a
                  :href="item.task.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline font-medium"
                >#{{ item.task.id }}: {{ item.task.title }}</a>
                <p
                  v-if="item.task.description"
                  class="whitespace-pre-line opacity-80"
                >
                  {{ item.task.description }}
                </p>
                <div
                  v-for="(r, j) in item.task.results"
                  :key="j"
                  class="whitespace-pre-line"
                >
                  <b>Результат:</b> {{ r }}
                </div>
              </div>
              <div
                v-if="item.task.clientTaskId"
                class="rounded border border-(--ui-color-divider-less) bg-(--ui-color-bg-content-secondary) p-3 space-y-1"
                data-testid="public-client-task"
              >
                <div class="text-xs uppercase opacity-60">
                  Ваша задача
                </div>
                <a
                  v-if="item.task.clientTaskUrl"
                  :href="item.task.clientTaskUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline font-medium"
                >#{{ item.task.clientTaskId }}{{ item.task.clientTask ? `: ${item.task.clientTask.title}` : '' }}</a>
                <span v-else>#{{ item.task.clientTaskId }}</span>
                <template v-if="item.task.clientTask">
                  <div class="flex items-center gap-2">
                    <img
                      v-if="item.task.clientTask.creatorIcon"
                      :src="item.task.clientTask.creatorIcon"
                      alt=""
                      referrerpolicy="no-referrer"
                      class="size-6 rounded-full object-cover"
                    >
                    <span>Поставил: {{ item.task.clientTask.creatorName || '—' }}</span>
                  </div>
                  <div>
                    Состояние: {{ item.task.clientTask.acceptedAt ? `принята ${date(item.task.clientTask.acceptedAt)}` : item.task.clientTask.state }}
                  </div>
                  <p
                    v-if="item.task.clientTask.description"
                    class="whitespace-pre-line opacity-80"
                  >
                    {{ item.task.clientTask.description }}
                  </p>
                  <div
                    v-for="(r, k) in item.task.clientTask.results"
                    :key="k"
                    class="whitespace-pre-line"
                  >
                    <b>Результат:</b> {{ r }}
                  </div>
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
        <div class="flex justify-between border-t pt-3 font-semibold">
          <span>Итого</span>
          <span>{{ money(invoice.total, invoice.currencyId) }}</span>
        </div>
      </section>
    </template>
  </div>
</template>
