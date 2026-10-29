<script setup lang="ts">
// Публичная страница: что это за приложение. Внутри портала она не используется —
// портал открывает /app (главная), /install и /invoice (встройка).
useSeoMeta({
  title: 'Счёт из задач — приложение для Битрикс24',
  description: 'Заполняет товарную часть счёта Битрикс24 по задачам и затраченному времени: ставки сотрудников, округление, наценки, названия строк через ИИ.'
})
</script>

<template>
  <!-- Вне портала (дизайн v2): только левая часть главной — что это и где взять -->
  <main class="min-h-dvh p-4 sm:p-8 flex items-center justify-center">
    <section class="idx-hero max-w-2xl w-full space-y-4">
      <span class="idx-chip">Приложение для Битрикс24</span>
      <h1 class="text-3xl font-semibold">
        Счёт <span class="tai-iris-text">из задач</span>
      </h1>
      <p class="opacity-80">
        Заполняет товарную часть счёта по задачам сделки или счёта и затраченному в них времени — по
        ставкам сотрудников, с наценками и НДС.
      </p>
      <ul class="list-disc pl-5 space-y-1 text-sm opacity-85">
        <li>Задача — одна строка по ставке ответственного, или каждая запись времени — строка по ставке её автора.</li>
        <li>Ставки сотрудников с датой начала действия; округление времени до часа, 30, 10 или 5 минут.</li>
        <li>Наценки на всё и по тегам задач; НДС по реквизитам вашей компании.</li>
        <li>Названия строк как есть или через ИИ; консультации ИИ по счёту — делом в карточке.</li>
        <li>Если в задаче чего-то не хватает, счёт не заполняется, а приложение показывает, что исправить.</li>
      </ul>
      <p class="text-sm opacity-70">
        Установка — из Битрикс24. Исходный код:
        <a
          class="text-(--tai-accent) hover:underline"
          href="https://github.com/bx-shef/invoice-from-tasks"
          target="_blank"
          rel="noopener"
        >github.com/bx-shef/invoice-from-tasks</a>.
      </p>
    </section>
  </main>
</template>

<style scoped>
.idx-hero {
  padding: 28px;
  border-radius: 20px;
  border: 1px solid var(--tai-border);
  background: var(--tai-surface);
}
.idx-chip {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--tai-accent-soft);
  color: var(--tai-accent);
}
</style>
