<script setup lang="ts">
// Общие настройки: округление, валюта ставок, источник названий строк, единица измерения, товар строк.
import { ROUNDING_LABELS, ROUNDING_STEPS } from '#shared/domain/time'
import type { AppSettings } from '#shared/domain/settings'

const settings = defineModel<AppSettings>({ required: true })

const b24 = useB24()
const catalog = useCatalog()

const roundingItems = ROUNDING_STEPS.map(step => ({ label: ROUNDING_LABELS[step], value: step }))
const namingItems = [
  { label: 'Как есть из задачи', value: 'plain', description: 'Тип 1 — заголовок задачи, тип 2 — описание записи времени' },
  { label: 'Через BitrixGPT', value: 'ai', description: 'Короткое понятное клиенту название по заголовку, описанию и отчёту' }
]
const currencies = ref<Array<{ label: string, value: string }>>([])
const measures = ref<Array<{ label: string, value: number }>>([])
const productLabel = ref('')

onMounted(async () => {
  try {
    const list = await b24.call<Array<{ CURRENCY?: unknown, FULL_NAME?: unknown }>>('crm.currency.list')
    currencies.value = (list ?? []).map(c => ({ label: `${c.CURRENCY} — ${c.FULL_NAME ?? ''}`, value: String(c.CURRENCY ?? '') })).filter(c => c.value)
  } catch {
    currencies.value = settings.value.currency ? [{ label: settings.value.currency, value: settings.value.currency }] : []
  }
  try {
    measures.value = (await catalog.measures()).map(m => ({ label: `${m.title} (код ${m.code})`, value: m.code }))
  } catch {
    measures.value = []
  }
  if (settings.value.defaultProductId) productLabel.value = await catalog.productName(settings.value.defaultProductId)
})

const measureModel = computed({
  get: () => settings.value.measureCode ?? 0,
  set: (v: number) => { settings.value.measureCode = v > 0 ? v : null }
})
</script>

<template>
  <div class="space-y-5">
    <B24FormField
      label="Округление затраченного времени"
      description="Время округляется вверх: начатый интервал считается целиком"
    >
      <B24Select
        v-model="settings.rounding"
        :items="roundingItems"
        value-key="value"
        class="w-72"
        data-testid="settings-rounding"
      />
    </B24FormField>

    <B24FormField
      label="Валюта ставок"
      description="Счёт в другой валюте заполнить нельзя — конвертации нет"
      required
    >
      <B24Select
        v-model="settings.currency"
        :items="currencies"
        value-key="value"
        placeholder="Выберите валюту"
        class="w-72"
        data-testid="settings-currency"
      />
    </B24FormField>

    <B24FormField label="Название строки счёта">
      <B24RadioGroup
        v-model="settings.naming"
        :items="namingItems"
        value-key="value"
        data-testid="settings-naming"
      />
    </B24FormField>

    <B24FormField
      label="Единица измерения строк"
      description="Например, «час». Не выбрано — портал возьмёт единицу товара или «шт»"
    >
      <B24Select
        v-model="measureModel"
        :items="[{ label: 'Не задавать', value: 0 }, ...measures]"
        value-key="value"
        class="w-72"
      />
    </B24FormField>

    <B24FormField
      label="Товар каталога для строк по умолчанию"
      description="Нужен наценкам по папкам и товарам. У ставки сотрудника может быть свой товар"
    >
      <div class="space-y-2">
        <div
          v-if="settings.defaultProductId"
          class="flex items-center gap-2"
        >
          <B24Badge
            color="air-secondary"
            :label="productLabel || `#${settings.defaultProductId}`"
          />
          <B24Button
            size="sm"
            color="air-tertiary"
            label="Убрать"
            @click="settings.defaultProductId = null"
          />
        </div>
        <CatalogPicker
          kind="product"
          @pick="(o) => { settings.defaultProductId = o.id; productLabel = o.name }"
        />
      </div>
    </B24FormField>
  </div>
</template>
