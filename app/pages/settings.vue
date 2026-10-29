<script setup lang="ts">
// Настройки приложения. Администратор видит всё; назначенный редактор ставок — только ставки;
// остальные сотрудники — объяснение, к кому обратиться. Права ещё раз проверяет сервер.
import { parseSettings, serializeSettings, settingsProblems, type AppSettings } from '#shared/domain/settings'
import { formatUsage } from '#shared/domain/storageBudget'
import { planSave, saveSummary } from '~/utils/saveBar'
import { SETTINGS_GROUPS, effectiveSection, settingsGroupsFor, type SettingsSection } from '~/utils/settingsNav'

const b24 = useB24()
const app = useAppSettings()
const toast = useToast()

const draft = ref<AppSettings | null>(null)
const loadError = ref('')
const saving = ref(false)
const ratesForm = useTemplateRef<{ dirty: boolean, blocked: string, saving: boolean, save: () => Promise<void> }>('ratesForm')

/** Что изменено и что можно сохранить — app/utils/saveBar.ts. */
const settingsDirty = computed(() => !!draft.value && serializeSettings(draft.value) !== serializeSettings(app.settings.value))
const plan = computed(() => planSave({
  isAdmin: app.isAdmin.value,
  settingsDirty: settingsDirty.value,
  settingsBlocked: usage.value && !usage.value.fits ? 'не влезают' : '',
  ratesDirty: !!ratesForm.value?.dirty,
  ratesBlocked: ratesForm.value?.blocked ?? ''
}))
const canSave = computed(() => plan.value.saveSettings || plan.value.saveRates)
const busy = computed(() => saving.value || !!ratesForm.value?.saving)

/** Разделы скрываются v-show (черновик живёт); админские не монтируются у редактора ставок. */
const groups = computed(() => settingsGroupsFor(app.isAdmin.value))
// Раздел из адреса (?section=vat) — ссылки «готовности портала» с главной ведут сразу в нужный
const route = useRoute()
const fromQuery = String(route.query.section ?? '')
const selected = ref<SettingsSection>(SETTINGS_GROUPS.flatMap(g => g.items).some(i => i.value === fromQuery) ? fromQuery as SettingsSection : 'general')
const section = computed(() => effectiveSection(selected.value, app.isAdmin.value))
const sectionTitle = computed(() => SETTINGS_GROUPS.flatMap(g => g.items).find(i => i.value === section.value)?.label ?? '')

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

/** Одна кнопка: сохраняет то, что можно, — настройки (админ) и ставки (свой запрос, свои права). */
async function save() {
  const p = plan.value
  if (!draft.value || !canSave.value) return
  saving.value = true
  const saved: string[] = []
  const failed: string[] = []
  const message = (e: unknown) => e instanceof Error ? e.message : String(e)
  try {
    if (p.saveSettings) {
      try {
        await app.saveSettings(draft.value)
        saved.push('настройки')
      } catch (e) {
        failed.push(`настройки: ${message(e)}`)
      }
    }
    if (p.saveRates && ratesForm.value) {
      try {
        await ratesForm.value.save()
        saved.push('ставки')
      } catch (e) {
        failed.push(`ставки: ${message(e)}`)
      }
    }
  } finally {
    saving.value = false
  }
  const s = saveSummary(saved, failed)
  toast.add({ title: s.title, description: s.description, color: s.ok ? 'air-primary-success' : 'air-primary-alert' })
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
                <div
                  class="settings-nav-group"
                  role="presentation"
                >
                  {{ g.title }}
                </div>
                <button
                  v-for="i in g.items"
                  :key="i.value"
                  type="button"
                  class="settings-nav-item"
                  :class="{ 'is-active': section === i.value }"
                  :aria-pressed="section === i.value"
                  @click="selected = i.value"
                >
                  {{ i.label }}
                </button>
              </template>
            </nav>
            <section
              class="settings-panel"
              aria-labelledby="settings-section-title"
            >
              <h2
                id="settings-section-title"
                class="text-base font-semibold mb-3"
              >
                {{ sectionTitle }}
              </h2>
              <div
                v-if="app.isAdmin.value"
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
                <SettingsRates ref="ratesForm" />
              </div>
              <div
                v-if="app.isAdmin.value"
                v-show="section === 'markup'"
                data-testid="settings-section-markup"
              >
                <SettingsMarkup
                  v-model="draft"
                />
              </div>
              <div
                v-if="app.isAdmin.value"
                v-show="section === 'vat'"
                data-testid="settings-section-vat"
              >
                <SettingsVat
                  v-model="draft"
                />
              </div>
              <div
                v-if="app.isAdmin.value"
                v-show="section === 'clientFields'"
                data-testid="settings-section-clientFields"
              >
                <SettingsClientFields
                  v-model="draft"
                />
              </div>
              <div
                v-if="app.isAdmin.value"
                v-show="section === 'publicPage'"
                data-testid="settings-section-publicPage"
              >
                <SettingsPublic
                  v-model="draft"
                />
              </div>
              <div
                v-if="app.isAdmin.value"
                v-show="section === 'prompts'"
                data-testid="settings-section-prompts"
              >
                <SettingsPrompts
                  v-model="draft"
                />
              </div>
              <div
                v-if="app.isAdmin.value"
                v-show="section === 'access'"
                data-testid="settings-section-access"
              >
                <SettingsAccess
                  v-model="draft"
                />
              </div>
              <div
                v-if="app.isAdmin.value"
                v-show="section === 'storage'"
                data-testid="settings-section-storage"
              >
                <SettingsStorage />
              </div>
            </section>
          </div>

          <!-- Одна панель на всё (дизайн v2): что изменено, место, кнопка. Ставки сохраняются своим запросом. -->
          <div
            v-if="app.isAdmin.value || app.mayEditRates.value"
            class="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-center gap-3 border-t py-3 px-3 bg-(--air-theme-bg-color) border-(--ui-color-divider-less)"
            data-testid="settings-savebar"
          >
            <span
              class="text-sm"
              :class="plan.changed.length ? '' : 'opacity-60'"
              data-testid="settings-changed"
            >
              {{ plan.changed.length ? `Изменено: ${plan.changed.join(', ')}` : 'Изменений нет' }}
            </span>
            <span
              v-if="usage && app.isAdmin.value"
              class="text-sm"
              :class="usage.fits ? 'opacity-70' : 'text-(--ui-color-accent-main-alert)'"
            >
              Место: {{ formatUsage(usage) }}<template v-if="!usage.fits">
                — не влезает: сократите промпты или замерьте предел (раздел «Хранилище»)
              </template>
            </span>
            <span
              v-if="plan.blocked.length"
              class="text-sm text-(--ui-color-accent-main-alert)"
              data-testid="settings-blocked"
            >Не сохранится — {{ plan.blocked.join('; ') }}</span>
            <B24Button
              color="air-primary"
              label="Сохранить"
              :loading="busy"
              :disabled="busy || !canSave"
              data-testid="settings-save"
              @click="save"
            />
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

<style scoped>
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
.settings-nav-item:focus-visible {
  outline: 2px solid var(--tai-accent);
  outline-offset: 1px;
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
  .settings-nav-item {
    flex-shrink: 0;
    min-height: 40px;
  }
  .settings-nav-group {
    display: none;
  }
}
</style>
