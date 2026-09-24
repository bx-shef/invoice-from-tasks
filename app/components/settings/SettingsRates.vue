<script setup lang="ts">
// Ставки часа: «сотрудник — ставка — с даты» (+ необязательный товар каталога).
// Сохраняются отдельно от прочих настроек: их меняют и назначенные не-администраторы.
import { MAX_RATE, validateRates, type RateEntry } from '#shared/domain/rates'
import { formatUsage } from '#shared/domain/storageBudget'

const app = useAppSettings()
const users = useUsers()
const catalog = useCatalog()
const toast = useToast()

const draft = ref<RateEntry[]>(app.rates.value.map(r => ({ ...r })))
const productNames = ref<Record<number, string>>({})
const productRow = ref<number | null>(null)
const saving = ref(false)

const issues = computed(() => validateRates(draft.value))
const usage = computed(() => app.usageWith({ rates: draft.value }))
const currency = computed(() => app.settings.value.currency || 'валюта не выбрана')

onMounted(async () => {
  await users.load(draft.value.map(r => r.userId))
  const ids = [...new Set(draft.value.map(r => r.productId).filter((id): id is number => !!id))]
  for (const id of ids) productNames.value[id] = await catalog.productName(id)
})

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function addRow() {
  const userId = await users.pickOne()
  if (!userId) return
  draft.value.push({ userId, rate: 0, from: today() })
}

function removeRow(index: number) {
  draft.value.splice(index, 1)
}

function rowIssues(index: number): string[] {
  return issues.value.filter(i => i.index === index).map(i => i.message)
}

function setProduct(index: number, option: { id: number, name: string }) {
  const row = draft.value[index]
  if (!row) return
  row.productId = option.id
  productNames.value[option.id] = option.name
  productRow.value = null
}

async function save() {
  saving.value = true
  try {
    await app.saveRates(draft.value)
    toast.add({ title: 'Ставки сохранены', color: 'air-primary-success' })
  } catch (e) {
    toast.add({ title: 'Не удалось сохранить ставки', description: e instanceof Error ? e.message : String(e), color: 'air-primary-alert' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm opacity-80">
      Ставка за час без наценки, в валюте ставок ({{ currency }}). Действует с указанной даты до следующей
      ставки того же сотрудника. Счёт считается по ставке на дату работы.
    </p>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left opacity-70">
            <th class="py-2 pr-3 font-medium">
              Сотрудник
            </th>
            <th class="py-2 pr-3 font-medium">
              Ставка
            </th>
            <th class="py-2 pr-3 font-medium">
              Действует с
            </th>
            <th class="py-2 pr-3 font-medium">
              Товар (необязательно)
            </th>
            <th class="py-2" />
          </tr>
        </thead>
        <tbody>
          <template
            v-for="(row, index) in draft"
            :key="`${row.userId}-${index}`"
          >
            <tr class="align-top border-t border-(--ui-color-divider-less)">
              <td class="py-2 pr-3">
                {{ users.label(row.userId) }}
              </td>
              <td class="py-2 pr-3 w-36">
                <B24InputNumber
                  v-model="row.rate"
                  :min="0"
                  :max="MAX_RATE"
                  :step="0.01"
                  :aria-label="`Ставка ${users.label(row.userId)}`"
                />
              </td>
              <td class="py-2 pr-3 w-44">
                <B24Input
                  v-model="row.from"
                  type="date"
                  :aria-label="`Действует с — ${users.label(row.userId)}`"
                />
              </td>
              <td class="py-2 pr-3">
                <div class="flex items-center gap-2">
                  <span v-if="row.productId">{{ productNames[row.productId] ?? `#${row.productId}` }}</span>
                  <span
                    v-else
                    class="opacity-60"
                  >по умолчанию</span>
                  <B24Button
                    size="xs"
                    color="air-tertiary"
                    :label="productRow === index ? 'Отмена' : 'Выбрать'"
                    @click="productRow = productRow === index ? null : index"
                  />
                  <B24Button
                    v-if="row.productId"
                    size="xs"
                    color="air-tertiary"
                    label="Убрать"
                    @click="row.productId = undefined"
                  />
                </div>
              </td>
              <td class="py-2 text-right">
                <B24Button
                  size="xs"
                  color="air-secondary-alert"
                  label="Удалить"
                  @click="removeRow(index)"
                />
              </td>
            </tr>
            <tr v-if="productRow === index">
              <td
                colspan="5"
                class="pb-3"
              >
                <CatalogPicker
                  kind="product"
                  @pick="(o) => setProduct(index, o)"
                />
              </td>
            </tr>
            <tr v-if="rowIssues(index).length">
              <td
                colspan="5"
                class="pb-2 text-sm text-(--ui-color-accent-main-alert)"
              >
                {{ rowIssues(index).join('; ') }}
              </td>
            </tr>
          </template>
          <tr v-if="!draft.length">
            <td
              colspan="5"
              class="py-4 opacity-70"
            >
              Ставок пока нет
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <B24Button
        color="air-secondary"
        label="Добавить ставку"
        data-testid="rates-add"
        @click="addRow"
      />
      <span
        class="text-sm"
        :class="usage.fits ? 'opacity-70' : 'text-(--ui-color-accent-main-alert)'"
        data-testid="rates-usage"
      >
        Место в настройках: {{ formatUsage(usage) }}<template v-if="usage.fits">, влезет ещё примерно {{ usage.rateCapacityLeft }} ставок</template><template v-else> — не влезает, удалите старые ставки</template>
      </span>
    </div>

    <div class="flex gap-2">
      <B24Button
        color="air-primary"
        label="Сохранить ставки"
        :loading="saving"
        :disabled="saving || issues.length > 0 || !usage.fits || app.loadFailed.value"
        data-testid="rates-save"
        @click="save"
      />
    </div>
  </div>
</template>
