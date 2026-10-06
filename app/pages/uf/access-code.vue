<script setup lang="ts">
// Поле «Код доступа к расшифровке счёта» в карточке компании или контакта (#34, этап 2).
// Код — 10 символов из криптостойкого генератора браузера (generateAccessCode). Клиент вводит его
// на публичной странице счёта. «Сгенерировать» / «Перегенерировать» / «Отозвать» (стереть).
import { generateAccessCode, isAccessCode } from '#shared/domain/appFieldTypes'
import { fieldContext, type FieldContext } from '~/utils/fieldPlacement'

const b24 = useB24()
const writer = useFieldWriter()

const ctx = ref<FieldContext | null>(null)
const code = ref('')
const busy = ref(false)
const note = ref('')
const error = ref('')

onMounted(async () => {
  const frame = await b24.init()
  if (!frame) return
  ctx.value = fieldContext(frame.placement.options)
  code.value = ctx.value.value
})

async function save(next: string, done: string) {
  if (!ctx.value) return
  busy.value = true
  error.value = ''
  try {
    const where = await writer.write(ctx.value, next)
    code.value = next
    note.value = where === 'form' ? `${done} — сохраните карточку` : done
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function generate() {
  if (code.value && !window.confirm('Перегенерировать код? Старый код перестанет открывать счета.')) return
  void save(generateAccessCode(n => crypto.getRandomValues(new Uint8Array(n))), code.value ? 'Код перегенерирован' : 'Код создан')
}

function revoke() {
  if (!window.confirm('Отозвать код? Клиент больше не сможет открыть счета по нему.')) return
  void save('', 'Код отозван')
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 p-1 text-sm">
    <template v-if="ctx">
      <code
        v-if="code"
        class="font-mono text-base select-all"
        data-testid="access-code-value"
      >{{ code }}</code>
      <span
        v-else
        class="opacity-70"
      >Код не создан</span>
      <span
        v-if="code && !isAccessCode(code)"
        class="text-(--ui-color-accent-main-alert)"
      >значение не похоже на код — перегенерируйте</span>
      <B24Button
        size="xs"
        color="air-secondary"
        :label="code ? 'Перегенерировать' : 'Сгенерировать'"
        :loading="busy"
        :disabled="busy"
        data-testid="access-code-generate"
        @click="generate"
      />
      <B24Button
        v-if="code"
        size="xs"
        color="air-secondary-alert"
        label="Отозвать"
        :disabled="busy"
        data-testid="access-code-revoke"
        @click="revoke"
      />
      <span
        v-if="note"
        class="opacity-70"
      >{{ note }}</span>
      <span
        v-if="error"
        class="text-(--ui-color-accent-main-alert)"
      >{{ error }}</span>
    </template>
  </div>
</template>
