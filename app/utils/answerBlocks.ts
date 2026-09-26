// Ответ BitrixGPT для окна приложения: markdown модели → абзацы и списки без v-html. Разбираем
// только то, что модель пишет в ответах консультации: абзацы, строки «- пункт» и «1. пункт»,
// заголовки `#` и **жирный**. Всё остальное — обычный текст: Vue его экранирует, так что разметка
// из ответа не станет HTML. В ленту тот же ответ уходит BB-кодом (shared/domain/activity.ts).

/** Кусок строки: обычный или жирный текст. */
export interface AnswerSpan {
  text: string
  bold: boolean
}

/** Блок ответа: абзац (строки через перенос) или список. */
export type AnswerBlock
  = | { kind: 'p', lines: AnswerSpan[][] }
    | { kind: 'ul' | 'ol', items: AnswerSpan[][] }

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const BOLD = /^\*\*(?!\s)[^*]+?(?<!\s)\*\*$/
const BOLD_SPLIT = /(\*\*(?!\s)[^*]+?(?<!\s)\*\*)/g

/** Строка → куски: `**жирный**` жирным, заголовок — целиком жирным. */
export function answerSpans(line: string): AnswerSpan[] {
  const heading = line.match(HEADING)
  if (heading) return [{ text: heading[1]!, bold: true }]
  // Как в markdown: `** x **` с пробелами у звёздочек — не жирный.
  return line.split(BOLD_SPLIT).filter(Boolean).map(part => BOLD.test(part)
    ? { text: part.slice(2, -2), bold: true }
    : { text: part, bold: false })
}

/** Ответ → блоки. Пустая строка разделяет абзацы; подряд идущие пункты — один список. */
export function answerBlocks(text: string): AnswerBlock[] {
  const out: AnswerBlock[] = []
  let paragraphOpen = false
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const last = out.at(-1)
    const bullet = line.match(BULLET)
    const numbered = bullet ? null : line.match(NUMBERED)
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol'
      const item = answerSpans((bullet ?? numbered)![1]!)
      if (last && last.kind === kind) last.items.push(item)
      else out.push({ kind, items: [item] })
      paragraphOpen = false
    } else if (!line.trim()) {
      paragraphOpen = false
    } else if (paragraphOpen && last?.kind === 'p') {
      last.lines.push(answerSpans(line))
    } else {
      out.push({ kind: 'p', lines: [answerSpans(line)] })
      paragraphOpen = true
    }
  }
  return out
}
