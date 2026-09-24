<script setup lang="ts">
// Поиск товара или папки каталога по названию. Выбор отдаётся событием `pick`.
import type { CatalogOption } from '~/composables/useCatalog'

const props = defineProps<{
  kind: 'product' | 'section'
  placeholder?: string
}>()
const emit = defineEmits<{ pick: [option: CatalogOption] }>()

const catalog = useCatalog()
const query = ref('')
const results = ref<CatalogOption[]>([])
const searching = ref(false)
const error = ref('')
const searched = ref(false)

async function search() {
  if (query.value.trim().length < 2) return
  searching.value = true
  error.value = ''
  try {
    results.value = props.kind === 'product'
      ? await catalog.searchProducts(query.value)
      : await catalog.searchSections(query.value)
    searched.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    searching.value = false
  }
}

function choose(option: CatalogOption) {
  emit('pick', option)
  results.value = []
  query.value = ''
  searched.value = false
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex gap-2">
      <B24Input
        v-model="query"
        class="flex-1"
        :placeholder="placeholder ?? (kind === 'product' ? 'Название товара, от 2 букв' : 'Название папки, от 2 букв')"
        @keydown.enter.prevent="search"
      />
      <B24Button
        color="air-secondary"
        label="Найти"
        :loading="searching"
        :disabled="query.trim().length < 2"
        @click="search"
      />
    </div>
    <p
      v-if="error"
      class="text-sm text-(--ui-color-accent-main-alert)"
    >
      {{ error }}
    </p>
    <ul
      v-if="results.length"
      class="border rounded-md divide-y border-(--ui-color-divider-less) divide-(--ui-color-divider-less)"
    >
      <li
        v-for="option in results"
        :key="option.id"
      >
        <button
          type="button"
          class="w-full text-left px-3 py-2 hover:bg-(--ui-color-bg-content-secondary)"
          @click="choose(option)"
        >
          {{ option.name }} <span class="opacity-60">#{{ option.id }}</span>
        </button>
      </li>
    </ul>
    <p
      v-else-if="searched"
      class="text-sm opacity-70"
    >
      Ничего не найдено
    </p>
  </div>
</template>
