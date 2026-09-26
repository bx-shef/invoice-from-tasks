<script setup lang="ts">
// Ответ консультации BitrixGPT в окне приложения — в стиле ответов CoPilot в Битрикс24: карточка
// `outline-copilot`, иконка CoPilot, оговорка про ИИ. Текст — абзацы и списки без v-html
// (app/utils/answerBlocks.ts): разметка из ответа модели остаётся текстом.
import CopilotIcon from '@bitrix24/b24icons-vue/solid/CopilotIcon'
import { answerBlocks } from '~/utils/answerBlocks'

const props = defineProps<{
  title: string
  text: string
}>()

const blocks = computed(() => answerBlocks(props.text))
</script>

<template>
  <B24Card
    variant="outline-copilot"
    data-testid="consult-answer"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <CopilotIcon class="size-6 shrink-0 text-(--ui-color-copilot-primary)" />
        <h3 class="font-semibold min-w-0 truncate">
          {{ title }}
        </h3>
        <B24Badge
          label="BitrixGPT"
          color="air-primary-copilot"
          size="sm"
          class="ms-auto"
        />
      </div>
    </template>

    <div class="space-y-3 text-sm leading-relaxed">
      <template
        v-for="(block, i) in blocks"
        :key="i"
      >
        <p v-if="block.kind === 'p'">
          <template
            v-for="(line, j) in block.lines"
            :key="j"
          >
            <br v-if="j">
            <component
              :is="span.bold ? 'strong' : 'span'"
              v-for="(span, k) in line"
              :key="k"
            >
              {{ span.text }}
            </component>
          </template>
        </p>
        <component
          :is="block.kind"
          v-else
          :class="block.kind === 'ul' ? 'list-disc ps-5 space-y-1' : 'list-decimal ps-5 space-y-1'"
        >
          <li
            v-for="(item, j) in block.items"
            :key="j"
          >
            <component
              :is="span.bold ? 'strong' : 'span'"
              v-for="(span, k) in item"
              :key="k"
            >
              {{ span.text }}
            </component>
          </li>
        </component>
      </template>
    </div>

    <template #footer>
      <p class="text-xs opacity-70">
        Ответ сформирован BitrixGPT и может быть неточным. Он сохранён в ленте счёта.
      </p>
    </template>
  </B24Card>
</template>
