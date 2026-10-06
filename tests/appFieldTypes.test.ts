import { describe, expect, it } from 'vitest'
import { ACCESS_CODE_ALPHABET, ACCESS_CODE_LENGTH, APP_FIELD_TYPES, crmEntityTypeOf, fieldTypeCalls, formatHookValue, fullTypeId, generateAccessCode, isAccessCode, parseHookValue, parseWebhookUrl } from '#shared/domain/appFieldTypes'
import { APP_FIELDS } from '#shared/domain/userFields'
import { userFieldAddCall } from '~/utils/userFieldRequests'
import { fieldContext, writePlan } from '~/utils/fieldPlacement'
import { serverProblems } from '~/utils/serverHealth'

const handlerOf = (path: string) => `https://app.example.by${path}`

describe('регистрация типов полей при установке', () => {
  it('нет типов — add обоих с обработчиком, подписью и высотой', () => {
    const calls = fieldTypeCalls([], handlerOf)
    expect(calls.map(c => c.method)).toEqual(['userfieldtype.add', 'userfieldtype.add'])
    expect(calls[0]!.params).toEqual({
      USER_TYPE_ID: 'ift_access_code',
      HANDLER: 'https://app.example.by/uf/access-code',
      TITLE: 'Код доступа к расшифровке счёта',
      DESCRIPTION: 'Счёт из задач: код для публичной страницы счёта',
      OPTIONS: { height: 60 }
    })
  })

  it('есть с тем же обработчиком — ничего; с другим (переезд) — update; полный код и регистр — тот же тип', () => {
    const existing = [
      { USER_TYPE_ID: 'rest_12_IFT_ACCESS_CODE', HANDLER: 'https://app.example.by/uf/access-code' },
      { userTypeId: 'ift_client_hook', handler: 'https://old.example.by/uf/client-hook' }
    ]
    const calls = fieldTypeCalls(existing, handlerOf)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'userfieldtype.update', params: { USER_TYPE_ID: 'ift_client_hook', HANDLER: 'https://app.example.by/uf/client-hook' } })
  })

  it('нет абсолютного адреса — не регистрируем; мусор в ответе — как пусто', () => {
    expect(fieldTypeCalls([], () => null)).toEqual([])
    expect(fieldTypeCalls('мусор', handlerOf)).toHaveLength(APP_FIELD_TYPES.length)
  })

  it('полный код типа', () => {
    expect(fullTypeId(12, 'ift_access_code')).toBe('rest_12_ift_access_code')
  })
})

describe('код доступа', () => {
  it('10 символов из алфавита без похожих знаков', () => {
    let seed = 0
    const code = generateAccessCode(n => Uint8Array.from({ length: n }, () => (seed += 37) % 256))
    expect(code).toHaveLength(ACCESS_CODE_LENGTH)
    expect(isAccessCode(code)).toBe(true)
    for (const c of '0O1lI') expect(ACCESS_CODE_ALPHABET.includes(c)).toBe(false)
  })

  it('байты за кратным длине алфавита отбрасываются — без перекоса', () => {
    // Только 255 (≥ предела) и 0 — код из одних первых символов алфавита, 255 не использован.
    const code = generateAccessCode(n => Uint8Array.from({ length: n }, (_, i) => (i % 2 ? 0 : 255)))
    expect(code).toBe(ACCESS_CODE_ALPHABET[0]!.repeat(ACCESS_CODE_LENGTH))
  })

  it('настоящий ГСЧ даёт разные коды', () => {
    const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n))
    expect(generateAccessCode(rnd)).not.toBe(generateAccessCode(rnd))
  })

  it('isAccessCode: длина и алфавит', () => {
    expect(isAccessCode('ABCDEFGHJK')).toBe(true)
    expect(isAccessCode('ABCDEFGHJ0')).toBe(false)
    expect(isAccessCode('ABCDEFGHJ')).toBe(false)
    expect(isAccessCode(null)).toBe(false)
  })
})

describe('вебхук клиента', () => {
  it('принимает входящий вебхук и нормализует', () => {
    expect(parseWebhookUrl(' https://Client.bitrix24.ru/rest/1/abc123def456 ')).toEqual({ url: 'https://client.bitrix24.ru/rest/1/abc123def456/', host: 'client.bitrix24.ru' })
  })

  it('отвергает не https, не /rest/<id>/<код>/, логин в адресе, порт, параметры', () => {
    for (const bad of [
      'http://client.bitrix24.ru/rest/1/abc123def456/',
      'https://client.bitrix24.ru/rest/1/',
      'https://client.bitrix24.ru/rest/x/abc123def456/',
      'https://client.bitrix24.ru/rest/1/abc/',
      'https://client.bitrix24.ru/rest/1/abc123def456/crm.deal.list',
      'https://u:p@client.bitrix24.ru/rest/1/abc123def456/',
      'https://client.bitrix24.ru:8443/rest/1/abc123def456/',
      'https://client.bitrix24.ru/rest/1/abc123def456/?a=1',
      'не адрес',
      42
    ]) expect(parseWebhookUrl(bad), String(bad)).toBeNull()
  })

  it('значение поля: домен открыто, вебхук — шифротекстом; чужой формат — null', () => {
    const v = formatHookValue('client.bitrix24.ru', 'iv:tag:data')
    expect(v).toBe('ift1|client.bitrix24.ru|iv:tag:data')
    expect(parseHookValue(v)).toEqual({ host: 'client.bitrix24.ru', sealed: 'iv:tag:data' })
    expect(parseHookValue('https://client.bitrix24.ru/rest/1/abc/')).toBeNull()
    expect(parseHookValue('ift1||x')).toBeNull()
    expect(parseHookValue(null)).toBeNull()
  })
})

describe('поле в карточке', () => {
  it('контекст из PLACEMENT_OPTIONS без учёта регистра', () => {
    expect(fieldContext({ MODE: 'edit', ENTITY_ID: 'CRM_COMPANY', FIELD_NAME: 'UF_CRM_SH_IFT_ACCESS_CODE', ENTITY_VALUE_ID: '15', VALUE: 'abc' }))
      .toEqual({ mode: 'edit', entityTypeId: 4, itemId: 15, fieldName: 'UF_CRM_SH_IFT_ACCESS_CODE', value: 'abc' })
    expect(fieldContext({ mode: 'view', entity_id: 'crm_contact', value: ['x'] })).toMatchObject({ mode: 'view', entityTypeId: 3, itemId: 0, value: 'x' })
    expect(fieldContext(null)).toEqual({ mode: 'view', entityTypeId: null, itemId: 0, fieldName: '', value: '' })
    expect(crmEntityTypeOf('CRM_DEAL')).toBeNull()
  })

  it('редактирование — в форму; просмотр — crm.item.update в camelCase; вне карточки — нельзя', () => {
    const view = fieldContext({ MODE: 'view', ENTITY_ID: 'CRM_CONTACT', FIELD_NAME: 'UF_CRM_SH_IFT_ACCESS_CODE', ENTITY_VALUE_ID: 7 })
    expect(writePlan({ ...view, mode: 'edit' }, 'X')).toEqual({ kind: 'form' })
    expect(writePlan(view, 'ABCDEFGHJK')).toEqual({ kind: 'item', call: { method: 'crm.item.update', params: { entityTypeId: 3, id: 7, fields: { ufCrmShIftAccessCode: 'ABCDEFGHJK' } } } })
    expect(writePlan({ ...view, itemId: 0 }, 'X').kind).toBe('none')
    expect(writePlan({ ...view, entityTypeId: null }, 'X').kind).toBe('none')
  })
})

describe('поля своих типов', () => {
  it('у компании и контакта — код доступа и вебхук; создаются с полным кодом типа', () => {
    const code = APP_FIELDS.find(f => f.entity === 'contact' && f.name === 'UF_CRM_SH_IFT_ACCESS_CODE')!
    expect(code.type).toBe('ift_access_code')
    const call = userFieldAddCall(code, 12)
    expect(call.method).toBe('crm.contact.userfield.add')
    expect(call.params.fields).toMatchObject({ USER_TYPE_ID: 'rest_12_ift_access_code', FIELD_NAME: 'SH_IFT_ACCESS_CODE' })
    expect(() => userFieldAddCall(code)).toThrow(/ID приложения/)
    expect(userFieldAddCall(APP_FIELDS[0]!).params.PARAMS).toMatchObject({ USER_TYPE_ID: 'string' })
  })
})

describe('health: ключ вебхуков', () => {
  it('не задан — проблема, не блокирующая', () => {
    expect(serverProblems({ config: { appCode: true, oauth: true, tokenKey: true, bitrixGpt: true, clientHookKey: false } }))
      .toEqual([{ variable: 'CLIENT_HOOK_ENC_KEY', effect: expect.stringMatching(/Вебхук клиента/), blocking: false }])
  })
})
