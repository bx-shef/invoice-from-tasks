<script setup lang="ts">
import { formatMoney } from '~/utils/fillPreview'
// Обработчик встройки CRM_SMART_INVOICE_DETAIL_TOOLBAR: карточка счёта → меню верхней кнопки →
// «Заполнить из задач». Здесь выбирают, откуда брать задачи и как считать, смотрят предпросмотр
// и пишут строки в счёт. Второй блок — консультации BitrixGPT.
import type { FillMode, TaskSource } from '#shared/domain/fill'
import { TimeoutError, withTimeout } from '#shared/utils/timeout'
import { rowUnit, type MeasureOption, type UnreadReason } from '~/utils/measures'
import type { ComponentPublicInstance } from 'vue'
import { answerYes, openConfirm, type ConfirmState, type OpenResult } from '~/utils/writeConfirm'
import type { WriteMode } from '~/utils/writeOutcome'
import { invoiceIdFromOptions, invoiceIdFromQuery } from '~/utils/placement'

const b24 = useB24()
const route = useRoute()
const app = useAppSettings()
const users = useUsers()
const fill = useInvoiceFill()
const catalog = useCatalog()
const toast = useToast()
const links = useInvoiceLinks()
const config = useRuntimeConfig()
/** Не удалось записать ссылки расшифровки в поля счёта (настройки → «Публичная страница»). */
const linksError = ref('')

const invoiceId = ref<number | null>(null)
// Задачи — только привязанные к счёту (владелец 2026-10-09: вариант «из сделки» убран)
const source = ref<TaskSource>('invoice')
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

const modeItems = [
  { label: 'Задача — одна строка', value: 'task', description: 'Время участников по их ставкам; без автора — по ответственному' },
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
watch(mode, () => fill.reset())
const result = computed(() => fill.result.value)
const taskTitles = computed(() => Object.fromEntries(fill.tasks.value.map(t => [t.id, t.title])))

// «Стоимость работ» задачи из окна счёта: ввели — сохранили в задачу и пересчитали таблицу
const costTask = ref<number | null>(null)
const costValue = ref('')
const costSaving = ref(false)
const costError = ref('')
function editCost(taskId: number) {
  const current = fill.tasks.value.find(t => t.id === taskId)?.workCost
  costTask.value = taskId
  costValue.value = current === null || current === undefined ? '' : String(current)
  costError.value = ''
}
async function saveCost(clear = false) {
  if (costTask.value === null) return
  const raw = costValue.value.replace(/\s/g, '').replace(',', '.')
  const value = clear || raw === '' ? null : Number(raw)
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    costError.value = 'Введите сумму числом, например 600 или 600,50'
    return
  }
  costSaving.value = true
  costError.value = ''
  try {
    await fill.setWorkCost(costTask.value, value)
    costTask.value = null
  } catch (e) {
    costError.value = e instanceof Error ? e.message : String(e)
  } finally {
    costSaving.value = false
  }
}
/**
 * Идущие вопросы перед записью (writeConfirm.ts) — на месте кнопок. Строки собрали заново или
 * сбросили — вопросы были о прежних строках: снимаем.
 */
const confirming = ref<ConfirmState | null>(null)
/** Нажата запись: перечитываем счёт, чтобы вопрос был о счёте сейчас. */
const opening = ref<WriteMode | null>(null)
const writeButtons: Record<WriteMode, Readonly<Ref<ComponentPublicInstance | null>>> = {
  replace: useTemplateRef<ComponentPublicInstance>('replaceButton'),
  append: useTemplateRef<ComponentPublicInstance>('appendButton')
}
const collectButton = useTemplateRef<ComponentPublicInstance>('collectButton')
/**
 * Фокус — на кнопку записи, с которой начали: её элемент исчезал (вопрос) или был неактивен. Счёт
 * изменился и предпросмотр сброшен — кнопок записи нет, фокус на «Собрать строки» (находка
 * пятого круга).
 */
async function focusWriteButton(writeMode: WriteMode) {
  await nextTick()
  const button = (writeButtons[writeMode].value ?? collectButton.value)?.$el as HTMLElement | undefined
  button?.focus()
}
watch(result, () => {
  confirming.value = null
})
/**
 * Пока открыт вопрос, источник, тип и «Собрать строки» заблокированы: иначе вопрос молча исчез бы
 * вместе со строками, о которых спрашивал (находка второго круга). Выйти — «Отмена».
 */
const locked = computed(() => busy.value || confirming.value !== null || opening.value !== null)

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
  // Адрес картинки QR — в поле счёта для шаблона документа (ссылку на расшифровку больше не пишем,
  // её показывает «Экономика счёта»). Независимо от расчёта: сбой не мешает заполнению счёта.
  void links.sync(invoiceId.value, new URL(origin.value).hostname, config.public.siteUrl || window.location.origin, { linkField: '', qrField: app.settings.value.publicPage.qrField })
    .catch((e: unknown) => {
      linksError.value = e instanceof Error ? e.message : String(e)
    })
  await Promise.all([fill.loadInvoice(invoiceId.value), measuresLoaded])
})

async function collect() {
  consultAnswer.value = null
  await fill.collect(source.value, mode.value)
}

/** «Добавить» спрашивает дважды, «Заменить» — если в счёте уже есть позиции (writeConfirm.ts). */
async function write(replace: boolean) {
  const writeMode: WriteMode = replace ? 'replace' : 'append'
  opening.value = writeMode
  let opened: OpenResult
  try {
    // Сначала перечитать счёт, потом спрашивать (openConfirm): вопрос — о счёте сейчас.
    opened = await openConfirm(writeMode, result.value?.rows.map(r => r.name) ?? [], {
      refresh: fill.prepareWrite,
      positions: () => fill.existing.value,
      now: () => performance.now()
    })
  } catch (e) {
    // prepareWrite сбои разбирает сам; сюда — только неожиданное: не молчим.
    fill.notice.value = `Не удалось подготовить запись (${e instanceof Error ? e.message : String(e)}) — ничего не записано.`
    opened = { kind: 'stop' }
  } finally {
    opening.value = null
  }
  if (opened.kind === 'ask') confirming.value = opened.state
  else if (opened.kind === 'write') await doWrite(replace, opened.askedIds)
  else await focusWriteButton(writeMode)
}

async function confirmYes() {
  const state = confirming.value
  if (!state) return
  // Слишком раннее «да» (двойной клик) answerYes возвращает тем же вопросом — ничего не меняется.
  confirming.value = answerYes(state, performance.now())
  if (!confirming.value) {
    await doWrite(state.mode === 'replace', state.existingIds)
    // Запись не пошла (счёт или позиции изменились, сбой) — блок вопроса исчез: фокус на кнопку.
    if (fill.step.value !== 'done') await focusWriteButton(state.mode)
  }
}

/** «Отмена» или Esc: вопросов нет, фокус — обратно на кнопку, с которой начали. */
async function cancelConfirm() {
  const writeMode = confirming.value?.mode
  confirming.value = null
  if (writeMode) await focusWriteButton(writeMode)
}

async function doWrite(replace: boolean, askedIds: readonly number[]) {
  // Сбои записи fill.write разбирает сам (и неожиданные — тоже): страница только сообщает итог.
  await fill.write(replace, askedIds)
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
          v-if="linksError"
          color="air-primary-warning"
          title="Адрес QR-кода в счёт не записан"
          :description="`${linksError}. Заполнение счёта это не затрагивает.`"
          data-testid="invoice-links-error"
        />

        <B24Alert
          v-if="fill.error.value"
          color="air-primary-alert"
          title="Ошибка"
          :description="fill.error.value"
          data-testid="fill-error"
        />

        <!-- Дизайн v2: «Как считать» карточками, главная кнопка справа -->
        <B24Card>
          <div class="flex flex-wrap items-end gap-4">
            <B24FormField
              label="Как считать"
              class="flex-1 min-w-72"
            >
              <B24RadioGroup
                v-model="mode"
                :items="modeItems"
                value-key="value"
                variant="card"
                orientation="horizontal"
                :disabled="locked"
                data-testid="fill-mode"
              />
            </B24FormField>
            <B24Button
              ref="collectButton"
              color="air-primary"
              size="lg"
              label="Собрать строки"
              :loading="fill.step.value === 'collecting' || measuresLoading"
              :disabled="locked || !fill.invoice.value || measuresLoading"
              data-testid="fill-collect"
              @click="collect"
            />
          </div>
          <template #footer>
            <div class="flex flex-wrap items-center gap-3">
              <span class="text-sm opacity-70">
                Названия: {{ app.settings.value.naming === 'ai' ? 'ИИ' : 'как есть из задач' }} · округление:
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

        <InvoiceEconomicsTable
          v-if="result"
          summary-only
          :items="fill.economics.value"
          :threshold="app.settings.value.economics.threshold"
          :origin="origin"
          :titles="taskTitles"
          :currency="fill.invoice.value?.currencyId ?? ''"
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
          :economics="fill.economics.value"
          :can-edit-cost="!!app.settings.value.taskFields.workCost && fill.step.value !== 'writing'"
          @edit-cost="editCost"
        />
        <B24Modal
          :open="costTask !== null"
          :title="`Стоимость работ · задача #${costTask ?? ''}`"
          description="Итог строки с НДС — то, что платит клиент. Сохраняется в задачу; строки и экономика пересчитаются сразу."
          @update:open="(v: boolean) => { if (!v) costTask = null }"
        >
          <template #body>
            <form
              class="space-y-2"
              @submit.prevent="saveCost()"
            >
              <B24Input
                v-model="costValue"
                inputmode="decimal"
                placeholder="например, 600"
                autofocus
                class="w-full"
                data-testid="cost-input"
              />
              <p class="text-sm opacity-70">
                {{ fill.tasks.value.find(t => t.id === costTask)?.title }}
              </p>
              <p
                v-if="costError"
                class="text-sm text-(--ui-color-accent-main-alert)"
              >
                {{ costError }}
              </p>
            </form>
          </template>
          <template #footer>
            <div class="flex flex-wrap gap-2">
              <B24Button
                color="air-primary"
                label="Сохранить"
                :loading="costSaving"
                :disabled="costSaving"
                data-testid="cost-save"
                @click="saveCost()"
              />
              <B24Button
                color="air-secondary"
                label="Очистить — считать по формуле"
                :disabled="costSaving"
                @click="saveCost(true)"
              />
            </div>
          </template>
        </B24Modal>
        <B24Alert
          v-if="fill.economyNotice.value"
          color="air-primary-warning"
          :description="fill.economyNotice.value"
          data-testid="economy-notice"
        />
        <InvoiceWriteConfirm
          v-if="confirming && fill.canWrite.value"
          :state="confirming"
          @confirm="confirmYes"
          @cancel="cancelConfirm"
        />
        <!-- Во время записи кнопки остаются на месте: иначе индикатор загрузки некому показать. -->
        <!-- Липкая панель внизу (дизайн v2): итог и запись всегда под рукой -->
        <div
          v-else-if="fill.canWrite.value || fill.step.value === 'writing'"
          class="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-(--tai-border) bg-(--tai-surface) px-4 py-3 shadow-lg"
        >
          <span
            v-if="result"
            class="text-sm opacity-70 mr-auto"
            data-testid="fill-write-summary"
          >Строк в счёт: {{ result.rows.length }} · сумма {{ formatMoney(fill.totals.value.total) }} {{ fill.invoice.value?.currencyId ?? '' }}</span>
          <B24Button
            ref="appendButton"
            color="air-secondary"
            label="Добавить к товарам счёта"
            :loading="fill.writing.value === 'append' || opening === 'append'"
            :disabled="busy || opening !== null"
            data-testid="fill-append"
            @click="write(false)"
          />
          <B24Button
            ref="replaceButton"
            color="air-primary"
            label="Заменить товары в счёте"
            :loading="fill.writing.value === 'replace' || opening === 'replace'"
            :disabled="busy || opening !== null"
            data-testid="fill-replace"
            @click="write(true)"
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
              Консультация ИИ
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
