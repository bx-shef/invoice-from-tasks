<script setup lang="ts">
// Обработчик встройки CRM_SMART_INVOICE_DETAIL_TOOLBAR: карточка счёта → меню верхней кнопки →
// «Заполнить из задач». Здесь выбирают, откуда брать задачи и как считать, смотрят предпросмотр
// и пишут строки в счёт. Второй блок — консультации BitrixGPT.
import type { FillMode, TaskSource } from '#shared/domain/fill'
import { TimeoutError, withTimeout } from '#shared/utils/timeout'
import { rowUnit, type MeasureOption, type UnreadReason } from '~/utils/measures'
import { answerYes, startConfirm, type ConfirmState } from '~/utils/writeConfirm'
import { invoiceIdFromOptions, invoiceIdFromQuery } from '~/utils/placement'

const b24 = useB24()
const route = useRoute()
const app = useAppSettings()
const users = useUsers()
const fill = useInvoiceFill()
const catalog = useCatalog()
const toast = useToast()

const invoiceId = ref<number | null>(null)
const source = ref<TaskSource>('deal')
const mode = ref<FillMode>('task')
const origin = ref('')
const consulting = ref('')
const consultAnswer = ref<{ title: string, text: string, notSaved?: string } | null>(null)
/** Справочник единиц; `null` — не прочитан (нет права чтения каталога): единица — из ОКЕИ. */
const measures = ref<MeasureOption[] | null>(null)
/**
 * Пока справочник грузится, «Собрать строки» ждёт (с индикатором): иначе предпросмотр на миг
 * показал бы единицу из ОКЕИ без предупреждения о подмене, и её успели бы записать (находка
 * /code-review). Ждём не дольше MEASURES_WAIT: завис портал — собираем с ОКЕИ, а поздний ответ
 * справочника всё равно обновит предпросмотр.
 */
const measuresLoading = ref(true)
const MEASURES_WAIT = 10_000
/** Почему справочник не прочитан: не ответил в срок — предпросмотр скажет об этом (rowUnit). */
const measuresUnread = ref<UnreadReason>('failed')
const unit = computed(() => rowUnit(measures.value, app.settings.value.measureCode, measuresUnread.value))

const sourceItems = [
  { label: 'Задачи связанной сделки', value: 'deal', description: 'Задачи, привязанные к сделке, из которой выставлен счёт' },
  { label: 'Задачи, привязанные к счёту', value: 'invoice', description: 'Задачи, у которых в CRM-привязке указан этот счёт' }
]
const modeItems = [
  { label: 'Задача — одна строка', value: 'task', description: 'Всё время задачи по ставке ответственного' },
  { label: 'Записи времени — строки', value: 'time', description: 'Каждая запись времени по ставке того, кто её внёс' }
]

const busy = computed(() => ['loading', 'collecting', 'writing'].includes(fill.step.value))
const roundingText = computed(() => {
  const { rounding, roundingDirection } = app.settings.value
  if (!rounding) return 'нет'
  return `${roundingDirection === 'nearest' ? 'к ближайшим' : 'вверх до'} ${rounding} мин`
})

// Сменили источник или тип — собранные строки к новым настройкам не относятся: сбрасываем
// предпросмотр, иначе кнопки записи записали бы строки, собранные по старому выбору (находка /code-review).
watch([source, mode], () => fill.reset())
const result = computed(() => fill.result.value)
/**
 * Идущие вопросы перед записью (writeConfirm.ts) — на месте кнопок. Строки собрали заново или
 * сбросили — вопросы были о прежних строках: снимаем.
 */
const confirming = ref<ConfirmState | null>(null)
watch(result, () => {
  confirming.value = null
})

onMounted(async () => {
  const frame = await b24.init()
  if (!frame) return
  frame.parent.setTitle('Заполнить счёт из задач')
  origin.value = frame.getTargetOrigin()
  invoiceId.value = invoiceIdFromOptions(frame.placement.options) ?? invoiceIdFromQuery(route.query.id)
  if (!invoiceId.value) return
  // Справочник единиц — сразу и параллельно с настройками и счётом; ошибка не мешает счёту:
  // без справочника предпросмотр возьмёт обозначение из ОКЕИ.
  const measuresLoaded = withTimeout(
    catalog.measures().then(
      (list) => {
        measures.value = list
      },
      () => {
        measures.value = null
      }
    ),
    MEASURES_WAIT,
    'справочник единиц не ответил'
  ).catch((e: unknown) => {
    // Поздний ответ всё равно заполнит measures — тогда пометка «не ответил» уйдёт сама.
    if (e instanceof TimeoutError) measuresUnread.value = 'timeout'
  }).finally(() => {
    measuresLoading.value = false
  })
  try {
    await app.load()
  } catch {
    return
  }
  await Promise.all([fill.loadInvoice(invoiceId.value), measuresLoaded])
})

async function collect() {
  consultAnswer.value = null
  await fill.collect(source.value, mode.value)
}

/** «Добавить» спрашивает дважды, «Заменить» — если в счёте уже есть позиции (writeConfirm.ts). */
function write(replace: boolean) {
  const existing = fill.existing.value
  const state = startConfirm(replace ? 'replace' : 'append', existing.map(r => r.productName), result.value?.rows.map(r => r.name) ?? [])
  if (state) confirming.value = state
  else void doWrite(replace, existing.length)
}

function confirmYes() {
  const state = confirming.value
  if (!state) return
  confirming.value = answerYes(state)
  if (!confirming.value) void doWrite(state.mode === 'replace', state.existing)
}

async function doWrite(replace: boolean, askedExisting: number) {
  await fill.write(replace, askedExisting)
  if (fill.step.value === 'done') toast.add({ title: 'Товары счёта обновлены', description: 'Обновите карточку счёта, чтобы увидеть изменения', color: 'air-primary-success' })
}

async function consult(promptId: string) {
  consulting.value = promptId
  consultAnswer.value = null
  try {
    consultAnswer.value = await fill.consult(promptId)
    if (consultAnswer.value.notSaved) toast.add({ title: 'Ответ получен, но не сохранился в ленте счёта', description: consultAnswer.value.notSaved, color: 'air-primary-warning' })
    else toast.add({ title: 'Ответ сохранён в ленте счёта', color: 'air-primary-success' })
  } catch (e) {
    toast.add({ title: 'Консультация не удалась', description: e instanceof Error ? e.message : String(e), color: 'air-primary-alert' })
  } finally {
    consulting.value = ''
  }
}
</script>

<template>
  <InPortalGate>
    <div class="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <B24Alert
        v-if="!invoiceId"
        color="air-primary-warning"
        title="Счёт не определён"
        description="Откройте приложение из карточки счёта: верхняя кнопка → «Заполнить из задач»."
      />
      <B24Alert
        v-else-if="app.loadFailed.value"
        color="air-primary-alert"
        title="Не удалось прочитать настройки приложения"
        description="Попробуйте открыть окно заново."
      />

      <template v-else>
        <h1 class="text-xl font-semibold">
          {{ fill.invoice.value?.title || `Счёт #${invoiceId}` }}
        </h1>

        <B24Alert
          v-if="fill.error.value"
          color="air-primary-alert"
          title="Ошибка"
          :description="fill.error.value"
          data-testid="fill-error"
        />

        <B24Card>
          <div class="grid gap-6 md:grid-cols-2">
            <B24FormField
              label="Откуда брать задачи"
              description="Источники не смешиваются"
            >
              <B24RadioGroup
                v-model="source"
                :items="sourceItems"
                value-key="value"
                :disabled="busy"
                data-testid="fill-source"
              />
            </B24FormField>
            <B24FormField label="Как считать">
              <B24RadioGroup
                v-model="mode"
                :items="modeItems"
                value-key="value"
                :disabled="busy"
                data-testid="fill-mode"
              />
            </B24FormField>
          </div>
          <template #footer>
            <div class="flex flex-wrap items-center gap-3">
              <B24Button
                color="air-primary"
                label="Собрать строки"
                :loading="fill.step.value === 'collecting' || measuresLoading"
                :disabled="busy || !fill.invoice.value || measuresLoading"
                data-testid="fill-collect"
                @click="collect"
              />
              <span class="text-sm opacity-70">
                Названия: {{ app.settings.value.naming === 'ai' ? 'BitrixGPT' : 'как есть из задач' }} · округление:
                {{ roundingText }} · в счёт: {{ app.settings.value.priceMode === 'sum' ? 'сумма строки × 1' : 'цена часа × часы' }}
              </span>
            </div>
          </template>
        </B24Card>

        <B24Alert
          v-if="fill.problems.value.length"
          color="air-primary-alert"
          title="Заполнить счёт нельзя"
          :description="fill.problems.value.join('; ')"
          data-testid="fill-problems"
        />

        <InvoiceFillPreview
          v-if="result"
          :rows="result.rows"
          :errors="result.errors"
          :warnings="result.warnings"
          :open-tasks="result.openTasks"
          :outliers="result.outliers"
          :totals="fill.totals.value"
          :vat="fill.vat.value"
          :price-mode="result.priceMode"
          :unit="unit.symbol"
          :unit-notice="unit.notice"
          :currency="fill.invoice.value?.currencyId ?? ''"
          :conversion="fill.conversion.value"
          :origin="origin"
          :user-label="users.label"
        />

        <InvoiceWriteConfirm
          v-if="confirming && fill.canWrite.value"
          :state="confirming"
          @confirm="confirmYes"
          @cancel="confirming = null"
        />
        <!-- Во время записи кнопки остаются на месте: иначе индикатор загрузки некому показать. -->
        <div
          v-else-if="fill.canWrite.value || fill.step.value === 'writing'"
          class="flex flex-wrap gap-3"
        >
          <B24Button
            color="air-primary-success"
            label="Заменить товары в счёте"
            :loading="fill.writing.value === 'replace'"
            :disabled="busy"
            data-testid="fill-replace"
            @click="write(true)"
          />
          <B24Button
            color="air-secondary"
            label="Добавить к товарам счёта"
            :loading="fill.writing.value === 'append'"
            :disabled="busy"
            data-testid="fill-append"
            @click="write(false)"
          />
        </div>
        <B24Alert
          v-if="fill.step.value === 'done'"
          color="air-primary-success"
          title="Готово"
          description="Строки записаны в счёт. Обновите карточку счёта, чтобы увидеть их."
        />
        <B24Alert
          v-if="fill.notice.value"
          color="air-primary-warning"
          :description="fill.notice.value"
        />
        <!-- Предпросмотр после записи может исчезнуть — предупреждение о курсе остаётся (#3). -->
        <B24Alert
          v-if="fill.step.value === 'done' && fill.conversion.value"
          color="air-primary-warning"
          :description="fill.conversion.value.notice"
          data-testid="fill-conversion"
        />

        <B24Card v-if="app.settings.value.consultPrompts.length">
          <template #header>
            <h2 class="font-semibold">
              Консультация BitrixGPT
            </h2>
          </template>
          <p class="text-sm opacity-70 mb-3">
            Промпт получает данные счёта{{ fill.tasks.value.length ? ' и найденных задач' : '' }}; ответ сохранится в ленте счёта.
          </p>
          <div class="flex flex-wrap gap-2">
            <B24Button
              v-for="p in app.settings.value.consultPrompts"
              :key="p.id"
              color="air-secondary-accent"
              :label="p.title"
              :loading="consulting === p.id"
              :disabled="!!consulting || !fill.invoice.value"
              @click="consult(p.id)"
            />
          </div>
          <InvoiceConsultAnswer
            v-if="consultAnswer"
            :title="consultAnswer.title"
            :text="consultAnswer.text"
            :not-saved="consultAnswer.notSaved"
            class="mt-4"
          />
        </B24Card>
      </template>
    </div>
  </InPortalGate>
</template>
