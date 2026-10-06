import { describe, expect, it } from 'vitest'
import { approvalMark, approvalUpdates, cleanComment, commentsFrom, commentTodoParams, COMMENT_TITLE_PREFIX, MAX_COMMENT_LENGTH, noteText } from '../shared/domain/approval'
import { camelFieldKey } from '../shared/domain/userFields'
import { parseSettings } from '../shared/domain/settings'

describe('текст комментария', () => {
  it('без управляющих символов и BB-кодов, обрезан по краям; пусто и слишком длинно — null', () => {
    expect(cleanComment('  Привет\r\n[b]мир[/b]\u0007 ')).toBe('Привет\n⟦b⟧мир⟦/b⟧')
    expect(cleanComment('   ')).toBeNull()
    expect(cleanComment(5)).toBeNull()
    expect(cleanComment('a'.repeat(MAX_COMMENT_LENGTH))).toHaveLength(MAX_COMMENT_LENGTH)
    expect(cleanComment('a'.repeat(MAX_COMMENT_LENGTH + 1))).toBeNull()
  })
})

describe('дело с комментарием', () => {
  it('на ответственного за счёт, срок +1 час, приставка в названии', () => {
    const p = commentTodoParams(5, 12, 'ООО Клиент', 'Поправьте', new Date('2026-10-06T10:00:00Z'))
    expect(p).toEqual({ ownerTypeId: 31, ownerId: 5, deadline: '2026-10-06T11:00:00.000Z', title: `${COMMENT_TITLE_PREFIX}: ООО Клиент`, description: 'Поправьте', pingOffsets: [0], responsibleId: 12 })
    expect(commentTodoParams(5, null, '', 'x', new Date(0))).not.toHaveProperty('responsibleId')
  })

  it('из дел счёта — только наши, закрытые с отметкой; заметка — ответ', () => {
    const list = commentsFrom([
      { ID: '3', SUBJECT: `${COMMENT_TITLE_PREFIX}: ООО`, DESCRIPTION: 'Текст', CREATED: '2026-10-06T10:00:00+03:00', COMPLETED: 'Y' },
      { ID: '2', SUBJECT: 'Позвонить клиенту', DESCRIPTION: 'чужое', COMPLETED: 'N' },
      { ID: '1', SUBJECT: COMMENT_TITLE_PREFIX, DESCRIPTION: 'Первый', COMPLETED: 'N' }
    ])
    expect(list.map(c => [c.id, c.closed])).toEqual([[3, true], [1, false]])
    expect(commentsFrom(Array.from({ length: 30 }, (_, i) => ({ ID: i + 1, SUBJECT: COMMENT_TITLE_PREFIX })), 20)).toHaveLength(20)
    expect(noteText({ text: ' Исправили ' })).toBe('Исправили')
    expect(noteText(null)).toBeNull()
  })
})

describe('отметка согласования', () => {
  const fields = { approvedField: 'UF_CRM_SMART_INVOICE_OK', approvedAtField: 'UF_CRM_SMART_INVOICE_OK_AT' }
  it('галка или дата — согласовано; поля не выбраны — кнопки нет', () => {
    expect(approvalMark({}, fields, camelFieldKey)).toEqual({ enabled: true, approved: false, approvedAt: null })
    expect(approvalMark({ ufCrmSmartInvoiceOk: 'Y' }, fields, camelFieldKey)).toMatchObject({ approved: true, approvedAt: null })
    expect(approvalMark({ ufCrmSmartInvoiceOkAt: '2026-10-06T10:00:00+03:00' }, fields, camelFieldKey)).toMatchObject({ approved: true, approvedAt: '2026-10-06T10:00:00+03:00' })
    expect(approvalMark({ ufCrmSmartInvoiceOk: 'N' }, fields, camelFieldKey).approved).toBe(false)
    expect(approvalMark({}, { approvedField: '', approvedAtField: '' }, camelFieldKey).enabled).toBe(false)
  })

  it('запись: галка Y и момент ISO в выбранные поля', () => {
    expect(approvalUpdates(fields, camelFieldKey, new Date('2026-10-06T10:00:00Z'))).toEqual({ ufCrmSmartInvoiceOk: 'Y', ufCrmSmartInvoiceOkAt: '2026-10-06T10:00:00.000Z' })
    expect(approvalUpdates({ approvedField: '', approvedAtField: '' }, camelFieldKey, new Date())).toEqual({})
  })
})

describe('настройки согласования', () => {
  it('стадия согласования убирается из обычных стадий; чат — только chat<ID>', () => {
    const s = parseSettings({ publicPage: { stages: ['DT31_1:N', 'DT31_1:S'], approvalStage: 'DT31_1:S' }, problemChat: { dialogId: 'chat15', title: 'Проблемы' } })
    expect(s.publicPage.stages).toEqual(['DT31_1:N'])
    expect(s.publicPage.approvalStage).toBe('DT31_1:S')
    expect(s.problemChat).toEqual({ dialogId: 'chat15', title: 'Проблемы' })
    expect(parseSettings({ problemChat: { dialogId: '15' } }).problemChat).toEqual({ dialogId: '', title: '' })
  })
})
