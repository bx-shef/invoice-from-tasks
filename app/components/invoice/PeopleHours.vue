<script setup lang="ts">
// «Время по людям» (дизайн v2, слайдер счёта): строка на участника — аватар, имя, «4,0 ч × 95»;
// часы без автора записи подсвечены — посчитаны по ставке ответственного. Только рисует:
// разбивку считает shared/domain/fill.ts (DraftRow.people).
import type { PersonHours } from '#shared/domain/fill'
import { formatMoney, formatNumber } from '~/utils/fillPreview'

defineProps<{
  people: PersonHours[]
  /** Имя сотрудника по ID. */
  userLabel: (id: number) => string
}>()

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
}
</script>

<template>
  <ul
    class="space-y-0.5 text-xs"
    data-testid="people-hours"
  >
    <li
      v-for="p in people"
      :key="`${p.userId}-${p.noAuthor ? 'n' : 'a'}`"
      class="flex items-center gap-1.5 rounded px-1 -mx-1"
      :class="p.noAuthor ? 'bg-(--tai-warning-bg) text-(--tai-warning)' : ''"
      :data-no-author="p.noAuthor || undefined"
    >
      <B24Avatar
        size="3xs"
        :text="initials(userLabel(p.userId))"
        :alt="userLabel(p.userId)"
      />
      <span>{{ userLabel(p.userId) }}</span>
      <span class="tabular-nums opacity-80">{{ formatNumber(p.hours) }} ч × {{ formatMoney(p.hourPrice) }}</span>
      <span
        v-if="p.noAuthor"
        class="font-medium"
      >· без автора → ответственный</span>
    </li>
  </ul>
</template>
