import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import { qrStyleOf, qrSvg, underLogo } from '#shared/domain/qrSvg'

describe('qrSvg', () => {
  const { modules } = QRCode.create('https://invoice-from-tasks.bx-shef.by/p-bel.bitrix24.by/i-153', { errorCorrectionLevel: 'H' })
  const m = { size: modules.size, get: (r: number, c: number) => Boolean(modules.get(r, c)) }

  it('перелив и ч/б — разные цвета, знак в центре', () => {
    expect(qrSvg(m)).toContain('#3B2FB0')
    expect(qrSvg(m, 'bw')).not.toContain('#3B2FB0')
    expect(qrSvg(m)).toContain('fill="#fff"/></g></svg>')
  })
  it('модули под знаком и в «глазках» не рисуются', () => {
    const svg = qrSvg(m)
    const n = m.size
    for (const [, x, y] of svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width=".84"/g)) {
      const c = Math.round(Number(x) - 0.08)
      const r = Math.round(Number(y) - 0.08)
      expect(underLogo(n, r, c)).toBe(false)
      expect((r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)).toBe(false)
    }
  })
  it('под знаком теряется не больше 10% тёмных модулей — коррекция H держит до 30%', () => {
    const n = m.size
    let dark = 0
    let hidden = 0
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!m.get(r, c)) continue
        dark++
        if (underLogo(n, r, c)) hidden++
      }
    }
    expect(hidden / dark).toBeLessThan(0.1)
    expect(hidden).toBeGreaterThan(0)
  })

  it('стиль из запроса', () => {
    expect([qrStyleOf('bw'), qrStyleOf('x'), qrStyleOf(undefined)]).toEqual(['bw', 'iris', 'iris'])
  })
})
