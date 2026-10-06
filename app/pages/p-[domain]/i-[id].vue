<script setup lang="ts">
// Публичная страница счёта (#34, этап 3): `/p-<домен портала>/i-<ID счёта>` — по QR-коду на счёте.
// Клиент вводит код доступа (поле «Код доступа» его компании или контакта) и видит расшифровку:
// клиент, «моя компания», дата, статус, строки «[123-456] …» с суммами и задачи — заголовок со
// ссылкой, описание, результат; задача клиента — по его вебхуку (этап 4): постановщик, состояние,
// дата принятия, описание и результат; без вебхука — только ссылка. Не в разрешённой стадии —
// спокойная фраза из настроек.
// Без фрейма портала: страница открыта всем, данные отдаёт сервер только по верному коду.
import type { PublicInvoiceView } from '#shared/domain/publicInvoice'

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
    if (res.state === 'open') invoice.value = res.invoice
    else closedText.value = res.text
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
    a.download = `${title || `document-${id}`}.pdf`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (e) {
    const err = e as { data?: { error?: string }, statusMessage?: string }
    docError.value = err.data?.error || err.statusMessage || 'Не удалось скачать документ'
  } finally {
    downloading.value = null
  }
}

const tasksById = computed(() => new Map((invoice.value?.tasks ?? []).map(t => [t.id, t])))
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
        <div class="flex flex-wrap gap-2">
          <B24Button
            v-for="d in invoice.documents"
            :key="d.id"
            color="air-secondary"
            :label="`${d.title} (PDF)`"
            :loading="downloading === d.id"
            :disabled="downloading !== null"
            @click="download(d.id, d.title)"
          />
        </div>
        <p
          v-if="docError"
          class="text-sm text-(--ui-color-accent-main-alert)"
        >
          {{ docError }}
        </p>
      </section>

      <section class="space-y-4">
        <article
          v-for="(row, i) in invoice.rows"
          :key="i"
          class="border-t border-(--ui-color-divider-less) pt-3 space-y-2"
          data-testid="public-row"
        >
          <div class="flex justify-between gap-3 font-medium">
            <span>{{ row.name }}</span>
            <span class="whitespace-nowrap">{{ money(row.sum, invoice.currencyId) }}</span>
          </div>
          <template v-if="row.taskId && tasksById.get(row.taskId)">
            <div class="text-sm space-y-1">
              <a
                :href="tasksById.get(row.taskId)!.url"
                target="_blank"
                rel="noopener noreferrer"
                class="underline"
              >Задача #{{ row.taskId }}: {{ tasksById.get(row.taskId)!.title }}</a>
              <p
                v-if="tasksById.get(row.taskId)!.description"
                class="whitespace-pre-line opacity-80"
              >
                {{ tasksById.get(row.taskId)!.description }}
              </p>
              <div
                v-for="(r, j) in tasksById.get(row.taskId)!.results"
                :key="j"
                class="whitespace-pre-line"
              >
                <b>Результат:</b> {{ r }}
              </div>
              <div v-if="tasksById.get(row.taskId)!.clientTaskId">
                Ваша задача:
                <a
                  v-if="tasksById.get(row.taskId)!.clientTaskUrl"
                  :href="tasksById.get(row.taskId)!.clientTaskUrl!"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline"
                >#{{ tasksById.get(row.taskId)!.clientTaskId }}{{ tasksById.get(row.taskId)!.clientTask ? `: ${tasksById.get(row.taskId)!.clientTask!.title}` : '' }}</a>
                <span v-else>#{{ tasksById.get(row.taskId)!.clientTaskId }}</span>
              </div>
              <div
                v-if="tasksById.get(row.taskId)!.clientTask"
                class="ml-3 pl-3 border-l border-(--ui-color-divider-less) space-y-1"
                data-testid="public-client-task"
              >
                <div class="flex items-center gap-2">
                  <img
                    v-if="tasksById.get(row.taskId)!.clientTask!.creatorIcon"
                    :src="tasksById.get(row.taskId)!.clientTask!.creatorIcon!"
                    alt=""
                    referrerpolicy="no-referrer"
                    class="size-6 rounded-full object-cover"
                  >
                  <span>Поставил: {{ tasksById.get(row.taskId)!.clientTask!.creatorName || '—' }}</span>
                </div>
                <div>
                  Состояние: {{ tasksById.get(row.taskId)!.clientTask!.acceptedAt ? `принята ${date(tasksById.get(row.taskId)!.clientTask!.acceptedAt!)}` : tasksById.get(row.taskId)!.clientTask!.state }}
                </div>
                <p
                  v-if="tasksById.get(row.taskId)!.clientTask!.description"
                  class="whitespace-pre-line opacity-80"
                >
                  {{ tasksById.get(row.taskId)!.clientTask!.description }}
                </p>
                <div
                  v-for="(r, k) in tasksById.get(row.taskId)!.clientTask!.results"
                  :key="k"
                  class="whitespace-pre-line"
                >
                  <b>Результат клиента:</b> {{ r }}
                </div>
              </div>
            </div>
          </template>
        </article>
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
