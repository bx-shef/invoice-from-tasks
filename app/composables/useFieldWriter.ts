// Запись значения поля своего типа (#34) по плану writePlan (app/utils/fieldPlacement.ts):
// в форму карточки или сразу в элемент — правами сотрудника, сервер в CRM не пишет.

import { writePlan, type FieldContext } from '~/utils/fieldPlacement'

export function useFieldWriter() {
  const b24 = useB24()

  /** Записывает значение; бросает с понятным текстом, если записать нельзя. */
  async function write(ctx: FieldContext, value: string): Promise<'form' | 'item'> {
    const plan = writePlan(ctx, value)
    if (plan.kind === 'none') throw new Error(plan.reason)
    if (plan.kind === 'form') {
      await b24.getOrThrow().placement.setValue(value)
      return 'form'
    }
    await b24.call(plan.call.method, plan.call.params)
    return 'item'
  }

  return { write }
}
