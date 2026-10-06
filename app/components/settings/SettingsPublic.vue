<script setup lang="ts">
// Публичная страница счёта (#34, этап 3): в каких стадиях клиент видит расшифровку по коду
// доступа, и что он видит в остальных. Адрес страницы — `/p-<домен портала>/i-<ID счёта>`.
import { LIMITS, type AppSettings } from '#shared/domain/settings'
import { APPROVED_AT_FIELD_TYPES, APPROVED_FIELD_TYPES, parseInvoiceLinkFields, publicQrUrl, type InvoiceFieldOption } from '#shared/domain/invoiceLinks'
import type { ChatOption } from '~/utils/chatOptions'
import { publicInvoiceUrl, stageItems, templateItems, type StageOption, type TemplateOption } from '~/utils/invoiceStages'

const settings = defineModel<AppSettings>({ required: true })

const b24 = useB24()
const stages = useInvoiceStages()
const links = useInvoiceLinks()
const chats = useChats()
const chatItems = ref<ChatOption[]>([])
const chatTerm = ref('')
const chatLoading = ref(false)
const chatError = ref('')
let chatSeq = 0

/** Чаты для выбора: короткий запрос — недавние, с 3 символов — поиск. Поздний ответ старого запроса не затирает новый. */
async function loadChats(query: string) {
  const seq = ++chatSeq
  chatLoading.value = true
  try {
    const list = await chats.search(query)
    if (seq === chatSeq) {
      chatError.value = ''
      chatItems.value = list
    }
  } catch (e) {
    if (seq === chatSeq) chatError.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (seq === chatSeq) chatLoading.value = false
  }
}
watchDebounced(chatTerm, q => void loadChats(q), { debounce: 400 })

/** Выбранный чат — в меню всегда: иначе его название пропадёт, когда поиск его не вернёт. */
const chatMenu = computed(() => {
  const saved = settings.value.problemChat
  const list = [{ label: 'Не писать', value: '' }, ...chatItems.value]
  if (saved.dialogId && !list.some(i => i.value === saved.dialogId)) list.splice(1, 0, { label: saved.title || saved.dialogId, value: saved.dialogId })
  return list
})
const problemChatId = computed({
  get: () => settings.value.problemChat.dialogId,
  set: (value: string) => {
    settings.value.problemChat = { dialogId: value, title: value ? (chatMenu.value.find(i => i.value === value)?.label ?? '') : '' }
  }
})

/** Стадия согласования — одна; в списке обычных стадий её нет (доступ в ней — свой режим). */
const approvalItems = computed(() => [{ label: 'Нет — режим выключен', value: '' }, ...items.value.filter(i => i.value !== '')])
const stageMenu = computed(() => items.value.filter(i => i.value !== settings.value.publicPage.approvalStage))
watch(() => settings.value.publicPage.approvalStage, (stage) => {
  if (stage) settings.value.publicPage.stages = settings.value.publicPage.stages.filter(s => s !== stage)
})
const config = useRuntimeConfig()

const options = ref<StageOption[] | null>(null)
const templateList = ref<TemplateOption[] | null>(null)
const templateError = ref('')
const loadError = ref('')
const fieldList = ref<InvoiceFieldOption[] | null>(null)
const fieldError = ref('')
const approvedList = ref<InvoiceFieldOption[]>([])
const approvedAtList = ref<InvoiceFieldOption[]>([])
const example = ref('')
const qrExample = ref('')

onMounted(async () => {
  const frame = b24.get()
  const portal = frame ? new URL(frame.getTargetOrigin()).hostname : 'ваш-портал.bitrix24.ru'
  example.value = publicInvoiceUrl(config.public.siteUrl || window.location.origin, portal, 123)
  qrExample.value = publicQrUrl(config.public.siteUrl || window.location.origin, portal, 123)
  void links.rawFields().then((raw) => {
    fieldList.value = parseInvoiceLinkFields(raw)
    approvedList.value = parseInvoiceLinkFields(raw, APPROVED_FIELD_TYPES)
    approvedAtList.value = parseInvoiceLinkFields(raw, APPROVED_AT_FIELD_TYPES)
  }, (e: unknown) => {
    fieldError.value = e instanceof Error ? e.message : String(e)
  })
  void loadChats('')
  // Стадии и шаблоны — независимо: сбой одного не прячет другое.
  void stages.templates().then((list) => {
    templateList.value = list
  }, (e: unknown) => {
    templateError.value = e instanceof Error ? e.message : String(e)
  })
  try {
    options.value = await stages.list()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  }
})

const items = computed(() => stageItems(options.value, settings.value.publicPage.stages))
/** Поля счёта для выбора; «не записывать» — первым. Сохранённое, которого нет в портале, — видно кодом. */
function fieldItems(saved: string, source: InvoiceFieldOption[] = fieldList.value ?? []) {
  const list = source.map(f => ({ label: `${f.label} (${f.name})`, value: f.name }))
  if (saved && !list.some(i => i.value === saved)) list.unshift({ label: `${saved} — нет в портале`, value: saved })
  return [{ label: 'Не записывать', value: '' }, ...list]
}
const linkItems = computed(() => fieldItems(settings.value.publicPage.linkField))
const qrItems = computed(() => fieldItems(settings.value.publicPage.qrField))
const approvedItems = computed(() => fieldItems(settings.value.publicPage.approvedField, approvedList.value))
const approvedAtItems = computed(() => fieldItems(settings.value.publicPage.approvedAtField, approvedAtList.value))
const templateMenu = computed(() => templateItems(templateList.value, settings.value.publicPage.templates))
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm opacity-80">
      Клиент открывает расшифровку счёта по ссылке (её удобно разместить QR-кодом в шаблоне счёта) и
      вводит код доступа — его выдаёт поле «Код доступа» в карточке компании или контакта. Адрес:
      <code class="select-all">{{ example }}</code> — где 123 — номер счёта.
    </p>

    <B24Alert
      v-if="loadError"
      color="air-primary-alert"
      title="Не удалось прочитать стадии счетов"
      :description="loadError"
    />

    <B24FormField
      label="Показывать расшифровку в стадиях"
      :description="`Не выбрано — расшифровка не показывается никогда. До ${LIMITS.publicStages} стадий`"
    >
      <B24SelectMenu
        v-model="settings.publicPage.stages"
        :items="stageMenu"
        value-key="value"
        multiple
        :loading="!options && !loadError"
        class="w-96 max-w-full"
        data-testid="public-stages"
      />
    </B24FormField>

    <B24FormField
      label="Стадия согласования"
      description="В этой стадии клиент видит расшифровку и пишет комментарии: каждый — дело на ответственного за счёт со сроком через час. Ответ клиенту — заметка к делу; закрытое дело клиент видит с отметкой. Среди стадий выше её быть не может"
    >
      <template #hint>
        <HelpLink anchor="approval-stage" />
      </template>
      <B24SelectMenu
        v-model="settings.publicPage.approvalStage"
        :items="approvalItems"
        value-key="value"
        :loading="!options && !loadError"
        class="w-96 max-w-full"
        data-testid="public-approval-stage"
      />
    </B24FormField>

    <B24FormField
      v-if="settings.publicPage.approvalStage"
      label="Кнопка «Согласовать»: поле-галка"
      description="Поле счёта «Да/Нет». Кнопка ставит галку и создаёт дело ответственному. Не выбрано ни это поле, ни дата — кнопки нет"
    >
      <B24SelectMenu
        v-model="settings.publicPage.approvedField"
        :items="approvedItems"
        value-key="value"
        :loading="!fieldList && !fieldError"
        class="w-96 max-w-full"
        data-testid="public-approved-field"
      />
    </B24FormField>
    <B24FormField
      v-if="settings.publicPage.approvalStage"
      label="Кнопка «Согласовать»: поле даты"
      description="Поле счёта «Дата» или «Дата и время» — момент согласования"
    >
      <B24SelectMenu
        v-model="settings.publicPage.approvedAtField"
        :items="approvedAtItems"
        value-key="value"
        :loading="!fieldList && !fieldError"
        class="w-96 max-w-full"
        data-testid="public-approved-at-field"
      />
    </B24FormField>

    <B24FormField
      label="Чат проблем"
      description="Сюда приложение напишет о подозрительных входах (5 неверных кодов к счёту за час, блокировка после 100) и о комментариях клиента, которые не удалось записать. Групповой чат; поиск — с 3 символов"
    >
      <template #hint>
        <HelpLink anchor="problem-chat" />
      </template>
      <B24Alert
        v-if="chatError"
        color="air-primary-alert"
        title="Не удалось прочитать чаты"
        :description="`${chatError}. Нужно право «im» в карточке приложения.`"
        class="mb-2"
      />
      <B24SelectMenu
        v-model="problemChatId"
        v-model:search-term="chatTerm"
        :items="chatMenu"
        value-key="value"
        ignore-filter
        :search-input="{ placeholder: 'Название чата…' }"
        :loading="chatLoading"
        class="w-96 max-w-full"
        data-testid="public-problem-chat"
      />
    </B24FormField>

    <B24FormField
      label="PDF документов для клиента"
      :description="`Клиент скачает последний документ счёта по каждому выбранному шаблону (Счёт, Акт, Счёт с НДС…). Не выбрано — документов нет. До ${LIMITS.publicTemplates} шаблонов`"
    >
      <B24Alert
        v-if="templateError"
        color="air-primary-alert"
        title="Не удалось прочитать шаблоны документов"
        :description="templateError"
        class="mb-2"
      />
      <B24SelectMenu
        v-model="settings.publicPage.templates"
        :items="templateMenu"
        value-key="value"
        multiple
        :search-input="{ placeholder: 'Поиск шаблона…' }"
        :loading="!templateList && !templateError"
        class="w-96 max-w-full"
        data-testid="public-templates"
      />
    </B24FormField>

    <B24Alert
      v-if="fieldError"
      color="air-primary-alert"
      title="Не удалось прочитать поля счёта"
      :description="fieldError"
    />
    <p class="text-sm opacity-80">
      Ссылки для печатных форм: при открытии «Заполнить из задач» приложение записывает в выбранные
      поля счёта адрес расшифровки и адрес картинки с её QR-кодом (<code class="select-all">{{ qrExample }}</code>).
      Поле картинки вставьте в шаблон документа как изображение. Поля создаёт кнопка «Создать поля приложения»
      на вкладке «Поля клиента» — и сразу выбирает их здесь.
    </p>
    <B24FormField
      label="Поле счёта для ссылки на расшифровку"
      description="Не выбрано — ссылка не записывается"
    >
      <B24SelectMenu
        v-model="settings.publicPage.linkField"
        :items="linkItems"
        value-key="value"
        :loading="!fieldList && !fieldError"
        class="w-96 max-w-full"
        data-testid="public-link-field"
      />
    </B24FormField>
    <B24FormField
      label="Поле счёта для картинки QR-кода"
      description="Не выбрано — адрес картинки не записывается"
    >
      <template #hint>
        <HelpLink anchor="qr-in-document" />
      </template>
      <B24SelectMenu
        v-model="settings.publicPage.qrField"
        :items="qrItems"
        value-key="value"
        :loading="!fieldList && !fieldError"
        class="w-96 max-w-full"
        data-testid="public-qr-field"
      />
    </B24FormField>

    <B24FormField
      label="Фраза для остальных стадий"
      description="Клиент увидит её после верного кода, если счёт не в выбранной стадии"
    >
      <B24Textarea
        v-model="settings.publicPage.closedText"
        :maxlength="LIMITS.closedText"
        :rows="3"
        class="w-full"
        data-testid="public-closed-text"
      />
    </B24FormField>
  </div>
</template>
