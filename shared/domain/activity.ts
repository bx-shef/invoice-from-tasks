// Дело «консультация» в счёте: параметры crm.activity.todo.add. Схема — как в ai-price-import
// (server/utils/todoActivity.ts): универсальное дело, описание в BB-разметке, выставляемой
// отдельным crm.activity.update (у todo.add параметра типа описания нет — проверено там вживую).

/**
 * Тип описания дела, который ставим отдельным crm.activity.update.
 *
 * ⚠ Документация и живой портал расходятся. `crm.enum.contenttype` (MCP): 1 — Plain text,
 * 2 — bbCode, 3 — HTML. Живой замер ai-price-import 06.08.2026 (scripts/probe-todo-carrier.mjs,
 * проверено владельцем глазами): у универсального дела при умолчании `2` BB-разметка видна
 * ИСХОДНИКОМ, при `3` — отрисовывается. Следуем замеру (AGENT_RULES §1: замер важнее текста) и
 * страхуемся от обеих трактовок — `neutralizeMarkup` убирает и BB-, и HTML-скобки из внешнего
 * текста, так что ни при BB, ни при HTML ответ модели не станет разметкой.
 */
export const DESCRIPTION_TYPE_BB = 3

/** Предел текста ответа в деле — стена текста в таймлайне всё равно не читается. */
export const MAX_ACTIVITY_TEXT = 20_000

/**
 * Обезвреживает разметку во внешнем тексте: ответ модели (на который влияют описания задач —
 * их пишет любой сотрудник) мог бы вставить `[URL=…]` или `<img onerror=…>` в описание дела,
 * которое видят все, кто открывает счёт. Полноширинные скобки выглядят похоже, но не разбираются
 * ни BB-парсером, ни браузером.
 */
export function neutralizeMarkup(text: string): string {
  return String(text ?? '')
    .replace(/\[/g, '［').replace(/\]/g, '］')
    .replace(/</g, '＜').replace(/>/g, '＞')
}

export interface ConsultActivityInput {
  invoiceId: number
  promptTitle: string
  answer: string
  responsibleId: number
  nowMs: number
}

/** Параметры crm.activity.todo.add для ответа консультации. Чистая функция. */
export function buildConsultActivity(input: ConsultActivityInput): Record<string, unknown> {
  const answer = neutralizeMarkup(input.answer).slice(0, MAX_ACTIVITY_TEXT)
  return {
    ownerTypeId: 31,
    ownerId: input.invoiceId,
    deadline: new Date(input.nowMs).toISOString(),
    title: neutralizeMarkup(`Консультация BitrixGPT: ${input.promptTitle}`).slice(0, 255),
    description: answer,
    ...(input.responsibleId > 0 ? { responsibleId: input.responsibleId } : {})
  }
}
