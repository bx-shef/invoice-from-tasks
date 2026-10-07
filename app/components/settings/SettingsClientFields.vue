<script setup lang="ts">
// Поля клиента (#34): UF задачи с ID задачи клиента (идёт в название строки «[123-456] Задача») и
// UF задачи с доменом портала клиента (для публичной страницы счёта). Поля
// приложения создаются только здесь, кнопкой — при установке и удалении приложение UF не трогает.
import { APP_FIELDS, type UserFieldOption } from '#shared/domain/userFields'
import type { AppSettings } from '#shared/domain/settings'
import { fieldItems, withAppEconomyFields, withAppFields, withAppInvoiceFields } from '~/utils/clientFieldSettings'
import type { FieldLists } from '~/composables/useUserFields'

const settings = defineModel<AppSettings>({ required: true })

const userFields = useUserFields()
const toast = useToast()

/** `null` — списки не прочитаны: в пунктах только сохранённые коды, без пометки «нет в портале». */
const lists = ref<FieldLists | null>(null)
const loadErrors = ref<string[]>([])
const loading = ref(true)
const creating = ref(false)

async function load() {
  loading.value = true
  const res = await userFields.listAll()
  // Хоть один список не прочитался — не помечаем поля «нет в портале» (сбой ≠ поля нет).
  lists.value = res.errors.length ? null : res.lists
  loadErrors.value = res.errors
  loading.value = false
}

onMounted(load)

function itemsFor(entity: keyof FieldLists, saved: string) {
  const list: UserFieldOption[] | null = lists.value ? lists.value[entity].options : null
  return fieldItems(list, saved)
}

async function createFields() {
  if (!lists.value) return
  creating.value = true
  try {
    const created = await userFields.createMissing(lists.value)
    settings.value.clientFields = withAppFields(settings.value.clientFields)
    settings.value.publicPage = withAppInvoiceFields(settings.value.publicPage)
    Object.assign(settings.value, withAppEconomyFields(settings.value))
    toast.add({
      title: created.length ? `Создано полей: ${created.length}` : 'Поля приложения уже есть',
      description: 'Поля выбраны в настройках — сохраните настройки',
      color: 'air-primary-success'
    })
  } catch (e) {
    toast.add({ title: 'Не удалось создать поля', description: e instanceof Error ? e.message : String(e), color: 'air-primary-alert' })
  } finally {
    creating.value = false
    await load()
  }
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm opacity-80">
      Выберите поля, где хранятся данные клиента. Если таких полей нет, создайте поля приложения
      кнопкой ниже — при установке приложение поля не создаёт и при удалении не стирает.
    </p>

    <B24Alert
      v-if="loadErrors.length"
      color="air-primary-alert"
      title="Не удалось прочитать список полей"
      :description="loadErrors.join('; ')"
    />

    <B24FormField
      label="ID задачи клиента — поле задачи"
      description="Номер задачи в портале клиента. При включённом «ID задачи в названии» строка счёта будет «[123-456] Задача»: 123 — ваша задача, 456 — задача клиента"
    >
      <B24SelectMenu
        v-model="settings.clientFields.task"
        :items="itemsFor('task', settings.clientFields.task)"
        value-key="value"
        :search-input="{ placeholder: 'Поиск поля…' }"
        :loading="loading"
        class="w-96 max-w-full"
        data-testid="client-field-task"
      />
    </B24FormField>

    <B24FormField
      label="Домен Битрикс24 клиента — поле задачи"
      description="Например, client.bitrix24.ru: портал, где живёт задача клиента. Для публичной страницы счёта — ссылка на задачу клиента"
    >
      <B24SelectMenu
        v-model="settings.clientFields.taskDomain"
        :items="itemsFor('task', settings.clientFields.taskDomain)"
        value-key="value"
        :search-input="{ placeholder: 'Поиск поля…' }"
        :loading="loading"
        class="w-96 max-w-full"
        data-testid="client-field-task-domain"
      />
    </B24FormField>

    <h3 class="font-medium pt-2">
      Экономика задач
      <HelpLink anchor="economics" />
    </h3>
    <B24FormField
      label="Стоимость работ — поле задачи"
      description="Итог строки с налогом, который платит клиент: в счёт уходит ровно эта сумма, цена без налога — обратным счётом. Пусто — строка по формуле"
    >
      <B24SelectMenu
        v-model="settings.taskFields.workCost"
        :items="itemsFor('task', settings.taskFields.workCost)"
        value-key="value"
        :search-input="{ placeholder: 'Поиск поля…' }"
        :loading="loading"
        class="w-96 max-w-full"
        data-testid="task-field-work-cost"
      />
    </B24FormField>
    <B24FormField
      label="Разница с формулой, % — поле задачи"
      description="«Собрать строки» записывает сюда (выставлено − формула) / формула × 100"
    >
      <B24SelectMenu
        v-model="settings.taskFields.diffPercent"
        :items="itemsFor('task', settings.taskFields.diffPercent)"
        value-key="value"
        :search-input="{ placeholder: 'Поиск поля…' }"
        :loading="loading"
        class="w-96 max-w-full"
        data-testid="task-field-diff"
      />
    </B24FormField>
    <B24FormField
      label="Дельта — поле задачи"
      description="Выставлено − формула в деньгах без НДС: −1200 — мы в минусе, 200 — в плюсе"
    >
      <B24SelectMenu
        v-model="settings.taskFields.delta"
        :items="itemsFor('task', settings.taskFields.delta)"
        value-key="value"
        :search-input="{ placeholder: 'Поиск поля…' }"
        :loading="loading"
        class="w-96 max-w-full"
        data-testid="task-field-delta"
      />
    </B24FormField>
    <B24FormField
      label="Порог пометки, %"
      description="Убыток или завышение больше порога подсвечиваются в списке задач"
    >
      <B24InputNumber
        v-model="settings.economics.threshold"
        :min="1"
        :max="500"
        class="w-32"
        data-testid="economics-threshold"
      />
    </B24FormField>

    <div class="space-y-2">
      <B24Button
        color="air-secondary"
        label="Создать поля приложения"
        :loading="creating"
        :disabled="creating || loading || !lists"
        data-testid="client-fields-create"
        @click="createFields"
      />
      <ul class="text-sm opacity-70 list-disc pl-5">
        <li
          v-for="f in APP_FIELDS"
          :key="`${f.entity}-${f.name}`"
        >
          {{ { task: 'Задача', company: 'Компания', contact: 'Контакт', invoice: 'Счёт' }[f.entity] }}: «{{ f.label }}» ({{ f.name }})
        </li>
      </ul>
    </div>
  </div>
</template>
