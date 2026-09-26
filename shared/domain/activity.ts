// Дело «консультация» в счёте — конфигурируемое дело приложения (crm.activity.configurable.add).
//
// Почему не crm.activity.todo.add, как раньше: универсальное дело даёт в ленте ДВЕ записи —
// открытое дело и серую запись истории (пробы 1–4 на тестовом портале 2026-09-26: двойник есть
// при любом сроке и без crm.activity.update), и выглядит как обычное дело. Владелец: оставить одну.
// Конфигурируемое дело, закрытое сразу, — одна запись в истории, не попадает в «Мои дела»,
// счётчики и пинги, и может выглядеть как ответ ИИ ядра: иконка `ai-process`, логотип
// `ai-copilot` (те же коды у записей CoPilot ядра — разбор коробки crm 26.800.0, отчёт владельца
// 2026-09-26). Структура `layout` — документация «Структура конфигурируемого дела» (MCP).
//
// ⚠ Метод работает только в контексте приложения (OAuth): вебхук получает ERROR_WRONG_CONTEXT
// (документация). Поэтому дело создаёт только страница во фрейме, правами сотрудника — ему нужно
// право изменять счёт, как и для записи товаров.

/** Предел текста ответа в деле — стена текста в ленте всё равно не читается. */
export const MAX_ACTIVITY_TEXT = 20_000
/** Предел заголовка записи. */
export const MAX_ACTIVITY_TITLE = 255
/** Источник данных дела (`originatorId`) — по нему дела приложения находятся в списке дел счёта. */
export const ACTIVITY_ORIGINATOR = 'invoice-from-tasks'
/** Иконка на линии ленты и логотип — те же коды, что у записей ИИ ядра (`crm.timeline.icon.list`). */
export const AI_ICON = 'ai-process'
export const AI_LOGO = 'ai-copilot'

/**
 * Обезвреживает разметку во внешнем тексте: ответ модели (на который влияют описания задач —
 * их пишет любой сотрудник) мог бы вставить `[URL=…]` или `<img onerror=…>` в запись, которую
 * видят все, кто открывает счёт. Полноширинные скобки выглядят похоже, но не разбираются ни
 * BB-парсером, ни браузером.
 */
export function neutralizeMarkup(text: string): string {
  return String(text ?? '')
    .replace(/\[/g, '［').replace(/\]/g, '］')
    .replace(/</g, '＜').replace(/>/g, '＞')
}

/**
 * Ответ модели (markdown) → BB-код для блока `largeText`: он разбирает BB (жирный, курсив) и
 * сворачивает длинный текст. Сначала обезвреживаем всё, что пришло от модели, и только потом
 * ставим свои теги — иначе `[URL]` из ответа стал бы ссылкой. Как в ядре
 * (`MarkdownToBBCodeTranslationService`): заголовки — жирной строкой, списки остаются строками
 * «- пункт» и «1. пункт».
 */
export function answerToBBCode(markdown: string): string {
  return neutralizeMarkup(String(markdown ?? '').replace(/\r\n?/g, '\n'))
    // Заголовки `#`…`######` — жирной строкой.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '[b]$1[/b]')
    // **жирный** и __жирный__.
    .replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, '[b]$1[/b]')
    .replace(/__(?!\s)(.+?)(?<!\s)__/g, '[b]$1[/b]')
    // *курсив* — одиночные звёздочки внутри строки (маркер списка «* » в начале строки не трогаем).
    .replace(/(^|[^*\n])\*(?![\s*])([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1[i]$2[/i]')
    // Маркеры списка `*` и `+` — к привычному «- ».
    .replace(/^([ \t]*)[*+][ \t]+/gm, '$1- ')
    .trim()
}

/** Контентный блок записи (документация: ContentBlockDto) — те типы, что использует приложение. */
export interface LayoutBlock {
  type: 'text' | 'largeText'
  properties: { value: string, size?: 'xs' | 'sm' | 'md', color?: 'base_50' | 'base_60' | 'base_70' | 'base_90' }
}

/** Параметры crm.activity.configurable.add (документация: LayoutDto без footer — действий нет). */
export interface ConsultActivityParams {
  ownerTypeId: number
  ownerId: number
  fields: { completed: true, originatorId: string, responsibleId?: number }
  layout: {
    icon: { code: string }
    header: { title: string }
    body: { logo: { code: string }, blocks: Record<string, LayoutBlock> }
  }
}

export interface ConsultActivityInput {
  invoiceId: number
  promptTitle: string
  answer: string
  responsibleId: number
}

/**
 * Параметры crm.activity.configurable.add для ответа консультации. Чистая функция.
 *
 * Дело закрыто сразу (`completed`): это запись о сделанном, а не задача — поэтому одна запись в
 * истории, без «Моих дел», счётчиков и пингов. Блоки — только из списка документации: `largeText`
 * (ответ, сворачивается), `text` (оговорка про ИИ; размеры `xs/sm/md`, цвета `base_50…90`).
 */
export function buildConsultActivity(input: ConsultActivityInput): ConsultActivityParams {
  return {
    ownerTypeId: 31,
    ownerId: input.invoiceId,
    fields: {
      completed: true,
      originatorId: ACTIVITY_ORIGINATOR,
      ...(input.responsibleId > 0 ? { responsibleId: input.responsibleId } : {})
    },
    layout: {
      icon: { code: AI_ICON },
      header: { title: neutralizeMarkup(`Консультация BitrixGPT: ${input.promptTitle}`).slice(0, MAX_ACTIVITY_TITLE) },
      body: {
        logo: { code: AI_LOGO },
        blocks: {
          answer: { type: 'largeText', properties: { value: answerToBBCode(String(input.answer ?? '').slice(0, MAX_ACTIVITY_TEXT)) } },
          disclaimer: { type: 'text', properties: { value: 'Ответ сформирован BitrixGPT и может быть неточным.', size: 'xs', color: 'base_60' } }
        }
      }
    }
  }
}
