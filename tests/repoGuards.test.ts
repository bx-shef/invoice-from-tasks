// Гарды репозитория — перенесены из эталона client-bank-alfa-by (mdReviewStamp.test.ts,
// ciWorkflowGuard.test.ts) и дополнены сверкой реестра REST-методов, которую там оставили в TODO.

import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

function trackedMarkdown(): string[] {
  return execSync('git ls-files --cached --others --exclude-standard "*.md"', { cwd: ROOT })
    .toString().trim().split('\n').filter(Boolean)
}

describe('документация', () => {
  it('каждый .md несёт штамп «> Last reviewed: YYYY-MM-DD»', () => {
    const files = trackedMarkdown()
    expect(files.length).toBeGreaterThan(0)
    const missing = files.filter(f => !/^> Last reviewed: \d{4}-\d{2}-\d{2}$/m.test(readFileSync(join(ROOT, f), 'utf8')))
    expect(missing, `Нет штампа в:\n${missing.join('\n')}`).toEqual([])
  })
})

describe('CI запускает проверки и падает на них', () => {
  const CI = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')

  it('ни один шаг не гасит провал (continue-on-error / || true)', () => {
    const lines = CI.split('\n').map(l => l.trim())
    expect(lines.filter(l => /^continue-on-error\s*:\s*true/.test(l))).toEqual([])
    expect(lines.filter(l => /^(- )?run:\s/.test(l) && /\|\|\s*(true|:)\b|;\s*true\b|\|\|\s*exit\s+0/.test(l))).toEqual([])
  })

  it('джоба `ci` запускает lint, test, typecheck и build', () => {
    for (const cmd of ['pnpm lint', 'pnpm test', 'pnpm typecheck', 'pnpm build']) {
      expect(CI, `CI не запускает \`${cmd}\``).toMatch(new RegExp(`run:\\s*${cmd}\\s*$`, 'm'))
    }
  })

  it('имя джобы `ci` сохранено — на него ссылается защита main', () => {
    expect(CI).toMatch(/^ {2}ci:\n {4}name: ci$/m)
  })
})

/** Все .ts/.vue файлы каталога рекурсивно. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.(ts|vue)$/.test(name)) out.push(path)
  }
  return out
}

/**
 * Имена REST-методов в коде: строковые литералы вида `crm.item.get`, `profile`, `scope`.
 * ⚠ Ищем по префиксам модулей, которые мы зовём; новый модуль — новый префикс здесь, иначе
 * метод пройдёт мимо реестра. Лучше лишнее совпадение, чем пропуск.
 */
const METHOD_RE = /'((?:crm|tasks?|catalog|user|app|placement|event)\.[a-z][\w.]*|profile|scope)'/g

describe('реестр REST-методов (docs/REST_METHODS.md)', () => {
  it('каждый метод, который зовёт код, описан в реестре', () => {
    const registry = readFileSync(join(ROOT, 'docs/REST_METHODS.md'), 'utf8')
    const used = new Map<string, string>()
    for (const file of [...sources(join(ROOT, 'app')), ...sources(join(ROOT, 'server')), ...sources(join(ROOT, 'shared'))]) {
      for (const m of readFileSync(file, 'utf8').matchAll(METHOD_RE)) {
        if (!used.has(m[1]!)) used.set(m[1]!, relative(ROOT, file))
      }
    }
    expect(used.size).toBeGreaterThan(10)
    const missing = [...used].filter(([method]) => !registry.includes(`\`${method}\``)).map(([m, f]) => `${m} (${f})`)
    expect(missing, `Нет в docs/REST_METHODS.md:\n${missing.join('\n')}`).toEqual([])
  })
})
