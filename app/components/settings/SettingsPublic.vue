<script setup lang="ts">
// Публичная страница счёта (#34, этап 3): в каких стадиях клиент видит расшифровку по коду
// доступа, и что он видит в остальных. Адрес страницы — `/p-<домен портала>/i-<ID счёта>`.
import { LIMITS, type AppSettings } from '#shared/domain/settings'
import { publicQrUrl, type InvoiceFieldOption } from '#shared/domain/invoiceLinks'
import { publicInvoiceUrl, stageItems, templateItems, type StageOption, type TemplateOption } from '~/utils/invoiceStages'

const settings = defineModel<AppSettings>({ required: true })

const b24 = useB24()
const stages = useInvoiceStages()
const links = useInvoiceLinks()
const config = useRuntimeConfig()

const options = ref<StageOption[] | null>(null)
const templateList = ref<TemplateOption[] | null>(null)
const templateError = ref('')
const loadError = ref('')
const fieldList = ref<InvoiceFieldOption[] | null>(null)
const fieldError = ref('')
const example = ref('')
const qrExample = ref('')

onMounted(async () => {
  const frame = b24.get()
  const portal = frame ? new URL(frame.getTargetOrigin()).hostname : 'ваш-портал.bitrix24.ru'
  example.value = publicInvoiceUrl(config.public.siteUrl || window.location.origin, portal, 123)
  qrExample.value = publicQrUrl(config.public.siteUrl || window.location.origin, portal, 123)
  void links.fields().then((list) => {
    fieldList.value = list
  }, (e: unknown) => {
    fieldError.value = e instanceof Error ? e.message : String(e)
  })
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
function fieldItems(saved: string) {
  const list = (fieldList.value ?? []).map(f => ({ label: `${f.label} (${f.name})`, value: f.name }))
  if (saved && !list.some(i => i.value === saved)) list.unshift({ label: `${saved} — нет в портале`, value: saved })
  return [{ label: 'Не записывать', value: '' }, ...list]
}
const linkItems = computed(() => fieldItems(settings.value.publicPage.linkField))
const qrItems = computed(() => fieldItems(settings.value.publicPage.qrField))
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
        :items="items"
        value-key="value"
        multiple
        :loading="!options && !loadError"
        class="w-96 max-w-full"
        data-testid="public-stages"
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
      Поле картинки вставьте в шаблон документа как изображение. Поля типа «Строка» или «Ссылка»
      создайте в настройках счетов CRM.
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
