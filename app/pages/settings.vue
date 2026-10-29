<script setup lang="ts">
// Настройки приложения. Администратор видит всё; назначенный редактор ставок — только ставки;
// остальные сотрудники — объяснение, к кому обратиться. Права ещё раз проверяет сервер.
import { parseSettings, settingsProblems, type AppSettings } from '#shared/domain/settings'
import { formatUsage } from '#shared/domain/storageBudget'

const b24 = useB24()
const app = useAppSettings()
const toast = useToast()

const draft = ref<AppSettings | null>(null)
const loadError = ref('')
const saving = ref(false)

/**
 * Разделы — боковым меню из 4 групп (дизайн v2, раздел 4): Расчёт · Клиент · ИИ · Система; на узком
 * экране — прокручиваемая лента. Разделы не размонтируются (v-show): черновик и поля живут.
 */
type Section = 'general' | 'rates' | 'markup' | 'vat' | 'clientFields' | 'publicPage' | 'prompts' | 'access' | 'storage'
const GROUPS: ReadonlyArray<{ title: string, items: ReadonlyArray<{ value: Section, label: string }> }> = [
  { title: 'Расчёт', items: [{ value: 'general', label: 'Общие' }, { value: 'rates', label: 'Ставки' }, { value: 'markup', label: 'Наценки' }, { value: 'vat', label: 'НДС' }] },
  { title: 'Клиент', items: [{ value: 'clientFields', label: 'Поля клиента' }, { value: 'publicPage', label: 'Публичная страница' }] },
  { title: 'ИИ', items: [{ value: 'prompts', label: 'Промпты' }] },
  { title: 'Система', items: [{ value: 'access', label: 'Доступ' }, { value: 'storage', label: 'Хранилище' }] }
]
const groups = computed(() => app.isAdmin.value
  ? GROUPS
  : GROUPS.map(g => ({ ...g, items: g.items.filter(i => i.value === 'rates') })).filter(g => g.items.length))
const section = ref<Section>('general')
watchEffect(() => {
  if (!app.isAdmin.value && app.loaded.value) section.value = 'rates'
})
const sectionTitle = computed(() => GROUPS.flatMap(g => g.items).find(i => i.value === section.value)?.label ?? '')

const usage = computed(() => (draft.value ? app.usageWith({ settings: draft.value }) : null))
const problems = computed(() => (draft.value ? settingsProblems(draft.value) : []))

onMounted(async () => {
  if (!await b24.init()) return
  b24.getOrThrow().parent.setTitle('Настройки: счёт из задач')
  try {
    await app.load()
    // parseSettings строит объект заново — это и есть глубокая копия для черновика.
    draft.value = parseSettings(app.settings.value)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  }
})

async function save() {
  if (!draft.value) return
  saving.value = true
  try {
    await app.saveSettings(draft.value)
    toast.add({ title: 'Настройки сохранены', color: 'air-primary-success' })
  } catch (e) {
    toast.add({ title: 'Не удалось сохранить настройки', description: e instanceof Error ? e.message : String(e), color: 'air-primary-alert' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <InPortalGate>
    <div class="p-4 sm:p-6 max-w-6xl mx-auto space-y-4 pb-28">
      <h1 class="text-xl font-semibold">
        Настройки
      </h1>

      <B24Alert
        v-if="loadError"
        color="air-primary-alert"
        title="Настройки не загрузились"
        :description="`${loadError}. Сохранение заблокировано, чтобы не затереть настройки портала.`"
      />

      <template v-else-if="draft && app.loaded.value">
        <B24Alert
          v-if="!app.isAdmin.value && !app.mayEditRates.value"
          color="air-primary-warning"
          title="Нет прав на настройки"
          description="Настройки меняет администратор портала; ставки — ещё и назначенные им сотрудники. Обратитесь к администратору."
        />
        <template v-else>
          <B24Alert
            v-if="app.isAdmin.value && problems.length"
            color="air-primary-warning"
            title="Заполнить счёт пока нельзя"
            :description="problems.join('; ')"
          />

          <div class="settings-layout">
            <nav
              class="settings-nav"
              aria-label="Разделы настроек"
              data-testid="settings-nav"
            >
              <template
                v-for="g in groups"
                :key="g.title"
              >
                <div class="settings-nav-group">
                  {{ g.title }}
                </div>
                <button
                  v-for="i in g.items"
                  :key="i.value"
                  type="button"
                  class="settings-nav-item"
                  :class="{ 'is-active': section === i.value }"
                  :aria-current="section === i.value ? 'page' : undefined"
                  @click="section = i.value"
                >
                  {{ i.label }}
                </button>
              </template>
            </nav>
            <section class="settings-panel">
              <h2 class="text-base font-semibold mb-3">
                {{ sectionTitle }}
              </h2>
              <div
                v-show="section === 'general'"
                data-testid="settings-section-general"
              >
                <SettingsGeneral
                  v-model="draft"
                />
              </div>
              <div
                v-show="section === 'rates'"
                data-testid="settings-section-rates"
              >
                <SettingsRates />
              </div>
              <div
                v-show="section === 'markup'"
                data-testid="settings-section-markup"
              >
                <SettingsMarkup
                  v-model="draft"
                />
              </div>
              <div
                v-show="section === 'vat'"
                data-testid="settings-section-vat"
              >
                <SettingsVat
                  v-model="draft"
                />
              </div>
              <div
                v-show="section === 'clientFields'"
                data-testid="settings-section-clientFields"
              >
                <SettingsClientFields
                  v-model="draft"
                />
              </div>
              <div
                v-show="section === 'publicPage'"
                data-testid="settings-section-publicPage"
              >
                <SettingsPublic
                  v-model="draft"
                />
              </div>
              <div
                v-show="section === 'prompts'"
                data-testid="settings-section-prompts"
              >
                <SettingsPrompts
                  v-model="draft"
                />
              </div>
              <div
                v-show="section === 'access'"
                data-testid="settings-section-access"
              >
                <SettingsAccess
                  v-model="draft"
                />
              </div>
              <div
                v-show="section === 'storage'"
                data-testid="settings-section-storage"
              >
                <SettingsStorage />
              </div>
            </section>
          </div>

          <!-- Общая кнопка сохраняет всё, кроме ставок: у ставок своя кнопка и свои права. -->
          <div
            v-if="app.isAdmin.value"
            class="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-center gap-3 border-t py-3 px-3 bg-(--air-theme-bg-color) border-(--ui-color-divider-less)"
          >
            <B24Button
              color="air-primary"
              label="Сохранить настройки"
              :loading="saving"
              :disabled="saving || !usage?.fits"
              data-testid="settings-save"
              @click="save"
            />
            <span
              v-if="usage"
              class="text-sm"
              :class="usage.fits ? 'opacity-70' : 'text-(--ui-color-accent-main-alert)'"
            >
              Место: {{ formatUsage(usage) }}<template v-if="!usage.fits">
                — не влезает: сократите промпты или замерьте предел (вкладка «Хранилище»)
              </template>
            </span>
          </div>
        </template>
      </template>

      <div
        v-else
        class="space-y-3"
        aria-busy="true"
      >
        <B24Skeleton class="h-10 w-full" />
        <B24Skeleton class="h-40 w-full" />
      </div>
    </div>
  </InPortalGate>
</template>

<style>
.settings-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 16px;
  align-items: start;
}
.settings-nav {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  border-radius: 16px;
  border: 1px solid var(--tai-border);
  background: var(--tai-surface);
}
.settings-nav-group {
  margin: 10px 8px 4px;
  font-size: 11px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--tai-text-3);
}
.settings-nav-group:first-child {
  margin-top: 0;
}
.settings-nav-item {
  text-align: left;
  padding: 8px 10px;
  border-radius: 10px;
  color: var(--tai-text);
}
.settings-nav-item:hover {
  background: var(--tai-surface-2);
}
.settings-nav-item.is-active {
  background: var(--tai-accent-soft);
  color: var(--tai-accent);
  font-weight: 600;
}
.settings-panel {
  min-width: 0;
  padding: 20px;
  border-radius: 16px;
  border: 1px solid var(--tai-border);
  background: var(--tai-surface);
}
/* Узкий экран — меню лентой сверху */
@media (max-width: 860px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }
  .settings-nav {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    white-space: nowrap;
  }
  .settings-nav-group {
    display: none;
  }
}
</style>
