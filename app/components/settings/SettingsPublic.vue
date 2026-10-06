<script setup lang="ts">
// Публичная страница счёта (#34, этап 3): в каких стадиях клиент видит расшифровку по коду
// доступа, и что он видит в остальных. Адрес страницы — `/p-<домен портала>/i-<ID счёта>`.
import { LIMITS, type AppSettings } from '#shared/domain/settings'
import { publicInvoiceUrl, stageItems, type StageOption } from '~/utils/invoiceStages'

const settings = defineModel<AppSettings>({ required: true })

const b24 = useB24()
const stages = useInvoiceStages()
const config = useRuntimeConfig()

const options = ref<StageOption[] | null>(null)
const loadError = ref('')
const example = ref('')

onMounted(async () => {
  const frame = b24.get()
  const portal = frame ? new URL(frame.getTargetOrigin()).hostname : 'ваш-портал.bitrix24.ru'
  example.value = publicInvoiceUrl(config.public.siteUrl || window.location.origin, portal, 123)
  try {
    options.value = await stages.list()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  }
})

const items = computed(() => stageItems(options.value, settings.value.publicPage.stages))
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
