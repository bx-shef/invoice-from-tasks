<script setup lang="ts">
// Поле «Вебхук Битрикс24 клиента» в карточке компании или контакта (#34, этап 2). Вебхук нужен,
// чтобы читать задачи клиента в его портале. Хранится ТОЛЬКО зашифрованным (сервер, ключ
// CLIENT_HOOK_ENC_KEY): пусто — поле ввода, задан — «указан для <домен>» и «Стереть». Сам вебхук
// после сохранения не показывается никогда.
import ObserverIcon from '@bitrix24/b24icons-vue/outline/ObserverIcon'
import CrossedEyeIcon from '@bitrix24/b24icons-vue/outline/CrossedEyeIcon'
import { parseHookValue, webhookProblem } from '#shared/domain/appFieldTypes'
import { fieldContext, type FieldContext } from '~/utils/fieldPlacement'

const b24 = useB24()
const { post } = useApi()
const writer = useFieldWriter()

const ctx = ref<FieldContext | null>(null)
const value = ref('')
const input = ref('')
/** Адрес виден (кнопка с глазом): проверить, что вставлено именно то. */
const show = ref(false)
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

/** Общий ход записи: занятость, ошибка, подпись «сохраните карточку». `next` — что записать. */
async function run(next: () => Promise<string>, done: string) {
  if (!ctx.value) return
  busy.value = true
  error.value = ''
  try {
    const v = await next()
    const where = await writer.write(ctx.value, v)
    value.value = v
    input.value = ''
    note.value = where === 'form' ? `${done} — сохраните карточку` : done
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function save() {
  // Проверка на месте — ошибка сразу и с причиной, без похода на сервер.
  const problem = webhookProblem(input.value)
  if (problem) {
    error.value = problem
    return
  }
  void run(async () => (await post<{ value: string }>('/api/client-hook/seal', { url: input.value })).value, 'Вебхук сохранён')
}

function clear() {
  if (!window.confirm('Стереть вебхук клиента?')) return
  void run(async () => '', 'Вебхук стёрт')
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
        <!-- new-password: Chrome игнорирует autocomplete="off" у поля-пароля и подставлял чужой
             сохранённый пароль (отчёт владельца 2026-10-07: «не пустил» адрес, которого там не было). -->
        <B24Input
          id="client-hook"
          v-model="input"
          :type="show ? 'text' : 'password'"
          name="client-hook"
          autocomplete="new-password"
          placeholder="https://портал.bitrix24.ru/rest/1/код/"
          class="w-80 max-w-full"
          :b24ui="{ trailing: 'pe-1' }"
          aria-label="Входящий вебхук портала клиента"
          data-testid="client-hook-input"
        >
          <template #trailing>
            <B24Button
              size="xs"
              color="air-tertiary-no-accent"
              :icon="show ? CrossedEyeIcon : ObserverIcon"
              :aria-label="show ? 'Скрыть адрес' : 'Показать адрес'"
              :aria-pressed="show"
              aria-controls="client-hook"
              @click="show = !show"
            />
          </template>
        </B24Input>
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
