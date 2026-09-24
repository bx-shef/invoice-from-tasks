<script setup lang="ts">
// Наценки: «на всё», по папкам каталога и по товарам. Приоритет — товар → папка → на всё.
import { MAX_MARKUP, type MarkupRule } from '#shared/domain/markup'
import type { AppSettings } from '#shared/domain/settings'

const settings = defineModel<AppSettings>({ required: true })

function addRule(list: MarkupRule[], option: { id: number, name: string }) {
  if (list.some(r => r.id === option.id)) return
  list.push({ id: option.id, name: option.name, percent: 0 })
}

function removeRule(list: MarkupRule[], id: number) {
  const index = list.findIndex(r => r.id === id)
  if (index >= 0) list.splice(index, 1)
}
</script>

<template>
  <div class="space-y-6">
    <B24FormField
      label="Наценка на всё, %"
      description="Применяется, если не сработало правило товара или папки"
    >
      <B24InputNumber
        v-model="settings.markup.defaultPercent"
        :min="0"
        :max="MAX_MARKUP"
        :step="1"
        class="w-40"
        data-testid="markup-default"
      />
    </B24FormField>

    <section class="space-y-2">
      <h3 class="font-medium">
        Папки каталога
      </h3>
      <p class="text-sm opacity-70">
        Правило папки действует и на вложенные папки; ближайшая папка сильнее родительской.
      </p>
      <div
        v-for="rule in settings.markup.sections"
        :key="rule.id"
        class="flex items-center gap-3"
      >
        <span class="flex-1">{{ rule.name || `#${rule.id}` }}</span>
        <B24InputNumber
          v-model="rule.percent"
          :min="0"
          :max="MAX_MARKUP"
          class="w-32"
          :aria-label="`Наценка для папки ${rule.name}`"
        />
        <B24Button
          size="xs"
          color="air-tertiary"
          label="Убрать"
          @click="removeRule(settings.markup.sections, rule.id)"
        />
      </div>
      <CatalogPicker
        kind="section"
        @pick="(o) => addRule(settings.markup.sections, o)"
      />
    </section>

    <section class="space-y-2">
      <h3 class="font-medium">
        Товары
      </h3>
      <div
        v-for="rule in settings.markup.products"
        :key="rule.id"
        class="flex items-center gap-3"
      >
        <span class="flex-1">{{ rule.name || `#${rule.id}` }}</span>
        <B24InputNumber
          v-model="rule.percent"
          :min="0"
          :max="MAX_MARKUP"
          class="w-32"
          :aria-label="`Наценка для товара ${rule.name}`"
        />
        <B24Button
          size="xs"
          color="air-tertiary"
          label="Убрать"
          @click="removeRule(settings.markup.products, rule.id)"
        />
      </div>
      <CatalogPicker
        kind="product"
        @pick="(o) => addRule(settings.markup.products, o)"
      />
    </section>
  </div>
</template>
