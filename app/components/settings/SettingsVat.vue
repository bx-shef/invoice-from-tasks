<script setup lang="ts">
// НДС по «Реквизитам вашей компании» (решение владельца, 2026-09-26): цена строки — без НДС, налог
// сверху; ставка — своя для каждой «моей компании» CRM. Счёт, чьих реквизитов здесь нет, не
// заполняется (shared/domain/vat.ts). Логика выбора — app/utils/vatSettings.ts.
import { LIMITS, type AppSettings } from '#shared/domain/settings'
import type { MyCompany, PortalVat } from '#shared/domain/vat'
import { applyVatChoice, refreshVatTitles, VAT_UNSET, vatOptions, vatRows, vatValueFor } from '~/utils/vatSettings'

const settings = defineModel<AppSettings>({ required: true })

const catalog = useCatalog()
const myCompanies = useMyCompanies()

const companies = ref<MyCompany[]>([])
const portalVats = ref<PortalVat[]>([])
const loading = ref(true)
const loadError = ref('')

/** Справка портала: где заводятся «Реквизиты вашей компании» (ссылка из документации счетов). */
const HELP_URL = 'https://helpdesk.bitrix24.ru/open/15987420/'

onMounted(async () => {
  try {
    const [list, vats] = await Promise.all([
      myCompanies.list(),
      // Без ставок портала вкладка всё равно работает: «Без НДС» и сохранённые ставки остаются.
      catalog.vatRates().catch(() => [] as PortalVat[])
    ])
    companies.value = list
    portalVats.value = vats
    const fresh = refreshVatTitles(settings.value.vat, list)
    if (fresh.some((v, i) => v !== settings.value.vat[i])) settings.value.vat = fresh
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

const options = computed(() => vatOptions(portalVats.value, settings.value.vat))
const rows = computed(() => vatRows(companies.value, settings.value.vat))
const full = computed(() => settings.value.vat.length >= LIMITS.vatCompanies)

function choose(company: MyCompany, value: unknown) {
  settings.value.vat = applyVatChoice(settings.value.vat, company, String(value))
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm opacity-80">
      Цена в строках счёта — <b>без НДС</b>, налог добавляется сверху. Ставка берётся по «Реквизитам
      вашей компании», выбранным в счёте. Если в счёте реквизиты не выбраны или для них ставка не
      задана, счёт не заполняется.
    </p>

    <B24Alert
      v-if="loadError"
      color="air-primary-alert"
      title="Не удалось прочитать «Реквизиты вашей компании»"
      :description="loadError"
    />
    <B24Alert
      v-else-if="!loading && !companies.length"
      color="air-primary-warning"
      title="В портале нет «Реквизитов вашей компании»"
      data-testid="vat-no-companies"
    >
      <template #description>
        Заведите их в CRM — без них счёт не заполнить.
        <a
          :href="HELP_URL"
          target="_blank"
          rel="noopener"
          class="underline"
        >Как это сделать</a>
      </template>
    </B24Alert>

    <p
      v-if="loading"
      class="text-sm opacity-70"
    >
      Загружаю реквизиты…
    </p>

    <ul
      v-if="rows.length"
      class="space-y-2"
      data-testid="vat-companies"
    >
      <li
        v-for="row in rows"
        :key="row.company.id"
        class="flex flex-wrap items-center gap-3"
      >
        <span class="flex-1 min-w-48">
          {{ row.company.title || `#${row.company.id}` }}
          <span
            v-if="row.missing"
            class="block text-xs text-(--ui-color-accent-main-warning)"
          >нет среди «Реквизитов вашей компании» портала — запись можно убрать</span>
        </span>
        <B24Select
          :model-value="vatValueFor(settings.vat, row.company.id)"
          :items="options"
          value-key="value"
          class="w-80"
          :disabled="full && vatValueFor(settings.vat, row.company.id) === VAT_UNSET"
          :aria-label="`НДС для ${row.company.title || row.company.id}`"
          @update:model-value="choose(row.company, $event)"
        />
      </li>
    </ul>
    <p
      v-if="full"
      class="text-sm text-(--ui-color-accent-main-warning)"
    >
      Задано {{ LIMITS.vatCompanies }} реквизитов — больше настройки не вмещают.
    </p>
  </div>
</template>
