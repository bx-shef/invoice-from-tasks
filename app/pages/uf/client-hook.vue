<script setup lang="ts">
// Поле «Вебхук Битрикс24 клиента» в карточке компании или контакта (#34, этап 2). Вебхук нужен,
// чтобы читать задачи клиента в его портале. Хранится ТОЛЬКО зашифрованным (сервер, ключ
// CLIENT_HOOK_ENC_KEY): пусто — поле ввода, задан — «указан для <домен>» и «Стереть». Сам вебхук
// после сохранения не показывается никогда.
import { parseHookValue } from '#shared/domain/appFieldTypes'
import { fieldContext, type FieldContext } from '~/utils/fieldPlacement'

const b24 = useB24()
const { post } = useApi()
const writer = useFieldWriter()

const ctx = ref<FieldContext | null>(null)
const value = ref('')
const input = ref('')
const busy = ref(false)
const note = ref('')
const error = ref('')

const hook = computed(() => parseHookValue(value.value))

onMounted(async () => {
  const frame = await b24.init()
  if (!frame) return
  ctx.value = fieldContext(frame.placement.options)
  value.value = ctx.value.value
})

async function write(next: string, done: string) {
  if (!ctx.value) return
  const where = await writer.write(ctx.value, next)
  value.value = next
  note.value = where === 'form' ? `${done} — сохраните карточку` : done
}

async function save() {
  busy.value = true
  error.value = ''
  try {
    const sealed = await post<{ value: string }>('/api/client-hook/seal', { url: input.value })
    await write(sealed.value, 'Вебхук сохранён')
    input.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function clear() {
  if (!window.confirm('Стереть вебхук клиента?')) return
  busy.value = true
  error.value = ''
  try {
    await write('', 'Вебхук стёрт')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 p-1 text-sm">
    <template v-if="ctx">
      <template v-if="value">
        <span data-testid="client-hook-set">{{ hook ? `Указан для ${hook.host}` : 'Указан (формат не распознан — сотрите и введите заново)' }}</span>
        <B24Button
          size="xs"
          color="air-secondary-alert"
          label="Стереть"
          :disabled="busy"
          data-testid="client-hook-clear"
          @click="clear"
        />
      </template>
      <template v-else>
        <B24Input
          v-model="input"
          type="password"
          autocomplete="off"
          placeholder="https://портал.bitrix24.ru/rest/1/код/"
          class="w-80 max-w-full"
          aria-label="Входящий вебхук портала клиента"
          data-testid="client-hook-input"
        />
        <B24Button
          size="xs"
          color="air-secondary"
          label="Сохранить"
          :loading="busy"
          :disabled="busy || !input.trim()"
          data-testid="client-hook-save"
          @click="save"
        />
      </template>
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
