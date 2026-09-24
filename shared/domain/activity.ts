// Дело «консультация» в счёте: параметры crm.activity.todo.add. Схема — как в ai-price-import
// (server/utils/todoActivity.ts): универсальное дело, описание в BB-разметке, выставляемой
// отдельным crm.activity.update (у todo.add параметра типа описания нет — проверено там вживую).

/** Тип описания дела: 3 — BB-код. При умолчании (HTML) переносы строк ответа слиплись бы. */
export const DESCRIPTION_TYPE_BB = 3

/** Предел текста ответа в деле — стена текста в таймлайне всё равно не читается. */
export const MAX_ACTIVITY_TEXT = 20_000

/**
 * Обезвреживает BB-скобки во внешнем тексте: ответ модели мог бы вставить `[URL=…]` и
 * превратить описание дела в ссылку. Полноширинные скобки выглядят так же, но не разбираются.
 */
export function neutralizeBb(text: string): string {
  return String(text ?? '').replace(/\[/g, '［').replace(/\]/g, '］')
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
  const answer = neutralizeBb(input.answer).slice(0, MAX_ACTIVITY_TEXT)
  return {
    ownerTypeId: 31,
    ownerId: input.invoiceId,
    deadline: new Date(input.nowMs).toISOString(),
    title: neutralizeBb(`Консультация BitrixGPT: ${input.promptTitle}`).slice(0, 255),
    description: answer,
    ...(input.responsibleId > 0 ? { responsibleId: input.responsibleId } : {})
  }
}
