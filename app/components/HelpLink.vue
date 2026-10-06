<script setup lang="ts">
// Ссылка «Что это значит?» рядом с настройкой: открывает ответ из FAQ справки слайдером портала
// (openSliderAppPage, `place = app-help-<якорь>` — как в client-bank-alfa-by). Портал отказал во
// вложенном слайдере или страница вне фрейма — обычный переход на /help.
import { FAQ_SLUG, HELP_SLIDER_WIDTH, helpPlace } from '~/utils/help'

const props = withDefaults(defineProps<{ anchor: string, label?: string }>(), { label: 'Что это значит?' })
const b24 = useB24()

async function open() {
  const frame = b24.get()
  if (frame) {
    try {
      await frame.slider.openSliderAppPage({ place: helpPlace(props.anchor), bx24_width: HELP_SLIDER_WIDTH, bx24_title: 'Справка' })
      return
    } catch {
      // Ниже — обычный переход.
    }
  }
  await navigateTo({ path: '/help', query: { p: FAQ_SLUG }, hash: `#${props.anchor}` })
}
</script>

<template>
  <button
    type="button"
    class="text-xs underline opacity-70 hover:opacity-100"
    data-testid="help-link"
    @click="open"
  >
    {{ props.label }}
  </button>
</template>
