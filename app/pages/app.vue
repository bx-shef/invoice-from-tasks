<script setup lang="ts">
// Главная страница приложения в портале (пункт «Приложения» → «Счёт из задач»): что умеет,
// готовы ли настройки, куда идти дальше. Администратору — ещё и что не настроено на сервере
// приложения (GET /api/health, app/utils/serverHealth.ts) и код приложения для B24_APP_CODE:
// изнутри портала его видно через `app.info`, а без него сервер отклоняет запросы из портала.
import { settingsProblems } from '#shared/domain/settings'
import { serverProblems, type ServerProblem } from '~/utils/serverHealth'
import { helpRouteForPlace, placeFromOptions } from '~/utils/help'
import { readiness } from '~/utils/readiness'

const b24 = useB24()
const app = useAppSettings()
const problems = computed(() => settingsProblems(app.settings.value))
const ready = computed(() => readiness(app.settings.value, app.rates.value))
const readyCount = computed(() => ready.value.filter(i => i.ok).length)
const canSettings = computed(() => app.isAdmin.value || app.mayEditRates.value)
// Строковое имя в :is Nuxt не резолвит — берём компонент явно
const NuxtLinkComponent = resolveComponent('NuxtLink')
/** Пункт ведёт в раздел, только если его можно открыть: редактору ставок — лишь «Ставки». */
const linkable = (section: string) => app.isAdmin.value || (app.mayEditRates.value && section === 'rates')
const loadError = ref('')
const serverIssues = ref<ServerProblem[]>([])
const appCode = ref('')

/** Проверка сервера — только для администратора: сотруднику чинить это нечем. */
async function checkServer(): Promise<void> {
  const health = await $fetch('/api/health').catch(() => null)
  serverIssues.value = serverProblems(health)
  if (serverIssues.value.some(p => p.variable === 'B24_APP_CODE')) {
    const info = await b24.call<{ CODE?: unknown }>('app.info').catch(() => null)
    appCode.value = typeof info?.CODE === 'string' ? info.CODE : ''
  }
}

onMounted(async () => {
  const frame = await b24.init()
  if (!frame) return
  // Слайдер справки (HelpLink): портал открыл главную страницу с `place = app-help-<якорь>`.
  const help = helpRouteForPlace(placeFromOptions(frame.placement.options))
  if (help) {
    await navigateTo(help, { replace: true })
    return
  }
  b24.getOrThrow().parent.setTitle('Счёт из задач')
  try {
    await app.load()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  }
  if (app.isAdmin.value) await checkServer()
})
</script>

<template>
  <InPortalGate>
    <div class="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <!-- Главная v2: слева — что это и куда идти, справа — готовность портала по реальным настройкам -->
      <section class="home-hero">
        <div class="space-y-4">
          <span class="home-chip">Приложение для Битрикс24</span>
          <h1 class="text-3xl font-semibold">
            Счёт <span class="tai-iris-text">из задач</span>
          </h1>
          <p class="opacity-80 max-w-xl">
            Заполняет товарную часть счёта по задачам и затраченному времени — по ставкам сотрудников,
            с наценками и НДС. Если в задаче чего-то не хватает, счёт не заполняется, а приложение
            показывает, что исправить.
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <B24Button
              v-if="canSettings"
              color="air-primary"
              label="Настройки"
              to="/settings"
              class="home-iris rounded-full"
              data-testid="app-settings"
            />
            <NuxtLink
              to="/help"
              class="px-3 py-2 text-(--tai-accent) hover:underline"
              data-testid="app-help"
            >Справка и ИИ-помощник</NuxtLink>
          </div>
        </div>
        <div
          v-if="!app.loaded.value && !loadError"
          class="space-y-2"
          aria-busy="true"
        >
          <B24Skeleton
            v-for="n in 5"
            :key="n"
            class="h-10 w-full"
          />
        </div>
        <div
          v-else-if="app.loaded.value && !loadError"
          class="space-y-2"
          data-testid="app-readiness"
        >
          <div class="text-sm opacity-70">
            Готовность портала · {{ readyCount }} из {{ ready.length }}
          </div>
          <component
            :is="linkable(i.section) ? NuxtLinkComponent : 'div'"
            v-for="i in ready"
            :key="i.key"
            :to="linkable(i.section) ? `/settings?section=${i.section}` : undefined"
            class="home-check"
            :class="{ 'is-warn': !i.ok && i.required, 'is-off': !i.ok && !i.required, 'is-link': linkable(i.section) }"
          >
            <span
              class="home-check-icon"
              aria-hidden="true"
            >{{ i.ok ? '✓' : i.required ? '!' : '–' }}</span>
            <span class="flex-1">{{ i.text }}</span>
            <span
              v-if="!i.ok && i.required"
              class="text-xs text-(--tai-warning)"
            >нужно для счёта</span>
          </component>
        </div>
        <B24Alert
          v-else-if="loadError"
          color="air-primary-alert"
          title="Настройки не загрузились"
          :description="loadError"
        />
      </section>

      <B24Alert
        v-if="serverIssues.length"
        :color="serverIssues.some(p => p.blocking) ? 'air-primary-alert' : 'air-primary-warning'"
        title="Сервер приложения настроен не полностью"
        data-testid="app-server-problems"
      >
        <template #description>
          <ul class="list-disc pl-5 space-y-1">
            <li
              v-for="p in serverIssues"
              :key="p.variable"
            >
              <code class="font-mono">{{ p.variable }}</code> — {{ p.effect }}.
            </li>
          </ul>
          <p
            v-if="appCode"
            class="mt-2"
          >
            Код приложения для <code class="font-mono">B24_APP_CODE</code>:
            <code
              class="font-mono"
              data-testid="app-code"
            >{{ appCode }}</code>
          </p>
          <p class="mt-2">
            Передайте это тому, кто обслуживает сервер приложения: переменные задаются в его окружении.
          </p>
        </template>
      </B24Alert>
      <B24Alert
        v-if="app.loaded.value && problems.length && !app.isAdmin.value"
        color="air-primary-warning"
        title="Нужна настройка"
        :description="`${problems.join('; ')}. Попросите администратора портала.`"
      />

      <div class="grid gap-3 md:grid-cols-3">
        <div class="home-card">
          <span
            class="home-card-icon"
            aria-hidden="true"
          >⏱</span>
          <div class="font-semibold">
            Задача или записи времени
          </div>
          <p class="text-sm opacity-75">
            Одна строка по ставке ответственного или каждая запись по ставке автора. Округление до
            часа, 30, 10 или 5 минут.
          </p>
        </div>
        <div class="home-card">
          <span
            class="home-card-icon"
            aria-hidden="true"
          >%</span>
          <div class="font-semibold">
            Ставки и наценки
          </div>
          <p class="text-sm opacity-75">
            Ставка с датой начала, своя для клиента. Наценка на всё и по тегам задач.
          </p>
        </div>
        <div class="home-card">
          <span
            class="home-card-icon"
            aria-hidden="true"
          >✳</span>
          <div class="font-semibold">
            Названия через ИИ
          </div>
          <p class="text-sm opacity-75">
            Понятные клиенту названия строк, оценка часов и консультации по счёту — делом в карточке.
          </p>
        </div>
      </div>

      <div class="home-card">
        <div class="font-semibold">
          Как пользоваться
        </div>
        <ol class="list-decimal pl-5 space-y-1 text-sm">
          <li>Откройте счёт → верхняя кнопка карточки (слева от «Документ») → «Заполнить из задач».</li>
          <li>Выберите, откуда брать задачи: из сделки счёта или привязанные к самому счёту.</li>
          <li>Выберите расчёт: задача — одна строка, или каждая запись времени — строка.</li>
          <li>Проверьте предпросмотр и запишите строки в счёт.</li>
        </ol>
      </div>
    </div>
  </InPortalGate>
</template>

<style scoped>
.home-hero {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 24px;
  align-items: center;
  padding: 28px;
  border-radius: 20px;
  border: 1px solid var(--tai-border);
  background: var(--tai-surface);
}
@media (max-width: 860px) {
  .home-hero {
    grid-template-columns: 1fr;
    padding: 20px;
  }
}
.home-chip {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--tai-accent-soft);
  color: var(--tai-accent);
}
.home-iris {
  background: var(--tai-iris-fill);
}
.home-check {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--tai-border);
  font-size: 14px;
}
.home-check.is-link:hover {
  background: var(--tai-surface-2);
}
.home-check.is-link:focus-visible {
  outline: 2px solid var(--tai-accent);
  outline-offset: 1px;
}
.home-check-icon {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 11px;
  background: var(--tai-success-bg);
  color: var(--tai-success);
  flex-shrink: 0;
}
.home-check.is-warn .home-check-icon {
  background: var(--tai-warning-bg);
  color: var(--tai-warning);
}
.home-check.is-off .home-check-icon {
  background: var(--tai-surface-2);
  color: var(--tai-text-3);
}
.home-card {
  padding: 16px;
  border-radius: 16px;
  border: 1px solid var(--tai-border);
  background: var(--tai-surface);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.home-card-icon {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--tai-accent-soft);
  color: var(--tai-accent);
}
</style>
