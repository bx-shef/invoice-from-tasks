<script setup lang="ts">
// Главная страница приложения в портале (пункт «Приложения» → «Счёт из задач»): что умеет,
// готовы ли настройки, куда идти дальше.
import { settingsProblems } from '#shared/domain/settings'

const b24 = useB24()
const app = useAppSettings()
const problems = computed(() => settingsProblems(app.settings.value))
const loadError = ref('')

onMounted(async () => {
  if (!await b24.init()) return
  b24.getOrThrow().parent.setTitle('Счёт из задач')
  try {
    await app.load()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  }
})
</script>

<template>
  <InPortalGate>
    <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <h1 class="text-xl font-semibold">
        Счёт из задач
      </h1>
      <p>
        Приложение заполняет товарную часть счёта по задачам и затраченному в них времени: ставки
        сотрудников, округление и наценки задаются здесь, в настройках.
      </p>

      <B24Alert
        v-if="loadError"
        color="air-primary-alert"
        title="Настройки не загрузились"
        :description="loadError"
      />
      <template v-else-if="app.loaded.value">
        <B24Alert
          v-if="problems.length"
          color="air-primary-warning"
          title="Нужна настройка"
          :description="`${problems.join('; ')}. ${app.isAdmin.value ? 'Откройте настройки.' : 'Попросите администратора портала.'}`"
        />
        <B24Alert
          v-else
          color="air-primary-success"
          title="Готово к работе"
          :description="`Ставок: ${app.rates.value.length}. Валюта: ${app.settings.value.currency}.`"
        />
      </template>

      <B24Card>
        <template #header>
          <h2 class="font-semibold">
            Как пользоваться
          </h2>
        </template>
        <ol class="list-decimal pl-5 space-y-1">
          <li>Откройте счёт → верхняя кнопка карточки (слева от «Документ») → «Заполнить из задач».</li>
          <li>Выберите, откуда брать задачи: из сделки счёта или привязанные к самому счёту.</li>
          <li>Выберите расчёт: задача — одна строка, или каждая запись времени — строка.</li>
          <li>Проверьте предпросмотр и запишите строки в счёт.</li>
        </ol>
      </B24Card>

      <div class="flex gap-2">
        <B24Button
          v-if="app.isAdmin.value || app.mayEditRates.value"
          color="air-primary"
          label="Настройки"
          to="/settings"
          data-testid="app-settings"
        />
      </div>
    </div>
  </InPortalGate>
</template>
