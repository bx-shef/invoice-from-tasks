// Makefile на сервере: чтение ./.env и цель `proxy-timeout` (docs/DEPLOY.md).
//
// ⚠ Прогоняется НАСТОЯЩИЙ make на тексте Makefile из репозитория, а не его пересказ: у макроса
// три слоя экранирования (make → sh → sed), и копия в тесте разошлась бы с ним молча — так
// в эталоне client-bank-alfa-by однажды потерялась половина выражения (`#` в make — комментарий).
// docker подменён скриптом в PATH, который пишет свои вызовы в журнал.

import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const MAKEFILE = readFileSync(join(ROOT, 'Makefile'), 'utf8')

/** Каталог с Makefile из репозитория (и целью-зондом) и, если задан, ./.env. */
function workdir(dotenv: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'ift-make-'))
  if (dotenv !== null) writeFileSync(join(dir, '.env'), dotenv)
  writeFileSync(join(dir, 'Makefile'), `${MAKEFILE}\n\nprobe:\n\t@printf '%s' "$(call env-value,DOMAIN)"\n`)
  return dir
}

function envValue(dotenv: string | null): string {
  return execFileSync('make', ['--no-print-directory', 'probe'], { cwd: workdir(dotenv), encoding: 'utf8' })
}

describe('Makefile читает ./.env текстом, не исполняя (макрос env-value эталона)', () => {
  it.each([
    ['голое значение', 'DOMAIN=invoice.example.by\n', 'invoice.example.by'],
    ['необязательный export', 'export DOMAIN=invoice.example.by\n', 'invoice.example.by'],
    ['двойные кавычки снимаются', 'DOMAIN="invoice.example.by"\n', 'invoice.example.by'],
    ['одинарные кавычки снимаются', 'DOMAIN=\'invoice.example.by\'\n', 'invoice.example.by'],
    ['пробелы вокруг =', 'DOMAIN = invoice.example.by\n', 'invoice.example.by'],
    ['комментарий в конце строки', 'DOMAIN=invoice.example.by # прод\n', 'invoice.example.by'],
    ['закомментированный ключ выше не побеждает', '#DOMAIN=old.by\nDOMAIN=invoice.example.by\n', 'invoice.example.by'],
    ['ключ-префикс и ключ-суффикс не путаются', 'DOMAIN_ALT=a.by\nOLD_DOMAIN=b.by\nDOMAIN=invoice.example.by\n', 'invoice.example.by'],
    ['повтор ключа — побеждает первая строка', 'DOMAIN=invoice.example.by\nDOMAIN=second.by\n', 'invoice.example.by'],
    ['CRLF не протекает в значение', 'DOMAIN=invoice.example.by\r\n', 'invoice.example.by'],
    ['хвостовые пробелы срезаются', 'DOMAIN=invoice.example.by   \n', 'invoice.example.by'],
    ['пробел внутри значения остаётся — его отвергнет проверка формата', 'DOMAIN=invoice exa.by\n', 'invoice exa.by'],
    ['ключа нет', 'OTHER=x\n', ''],
    ['файла нет', null, '']
  ])('%s', (_label, dotenv, expected) => {
    expect(envValue(dotenv)).toBe(expected)
  })

  it('значение не исполняется — подстановка команды остаётся текстом', () => {
    const dir = workdir('DOMAIN=$(touch PWNED)\n')
    expect(execFileSync('make', ['--no-print-directory', 'probe'], { cwd: dir, encoding: 'utf8' })).toBe('$(touch PWNED)')
    expect(existsSync(join(dir, 'PWNED'))).toBe(false)
  })
})

/** Подставной docker: `ps` печатает FAKE_PS, `exec … cat` — FAKE_CAT, `exec … grep` — код FAKE_GREP. */
const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$1" in
  ps) printf '%b' "$FAKE_PS" ;;
  exec)
    case "$*" in
      *" cat "*) printf '%s' "$FAKE_CAT" ;;
      *" grep "*) exit \${FAKE_GREP:-0} ;;
    esac ;;
esac
exit 0
`

// Рядом с прокси — companion обоих поколений: старый образ тоже содержит «nginx-proxy» в имени.
const ONE_PROXY = 'nginx-proxy nginxproxy/nginx-proxy:1.7\\nnginx-proxy-acme nginxproxy/acme-companion:2.5\\nletsencrypt jrcs/letsencrypt-nginx-proxy-companion:latest\\ninvoice-from-tasks ghcr.io/bx-shef/invoice-from-tasks:latest\\n'

interface Run { code: number, out: string, calls: string[], dir: string }

function proxyTimeout(dotenv: string | null, opts: { args?: string[], env?: Record<string, string> } = {}): Run {
  const dir = workdir(dotenv)
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER)
  chmodSync(join(bin, 'docker'), 0o755)
  const log = join(dir, 'docker.log')
  writeFileSync(log, '')
  const env: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: dir,
    DOCKER_LOG: log,
    FAKE_PS: ONE_PROXY,
    PT_SETTLE: '0',
    ...opts.env
  }
  const res = spawnSync('make', ['--no-print-directory', 'proxy-timeout', ...(opts.args ?? [])], { cwd: dir, env, encoding: 'utf8' })
  const calls = readFileSync(log, 'utf8').split('\n').filter(l => l && !l.startsWith('ps '))
  return { code: res.status ?? -1, out: `${res.stdout}${res.stderr}`, calls, dir }
}

const FILE = '/etc/nginx/vhost.d/invoice.example.by_location'

describe('make proxy-timeout', () => {
  it('находит прокси, пишет таймаут, пересоздаёт приложение и проверяет, что конфиг подключил файл', () => {
    const r = proxyTimeout('DOMAIN=invoice.example.by\n')
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('прокси: nginx-proxy, домен: invoice.example.by, таймаут: 400s')
    expect(r.calls).toContain(`exec nginx-proxy sh -c mkdir -p /etc/nginx/vhost.d && echo 'proxy_read_timeout 400s;' > ${FILE}`)
    expect(r.calls).toContain('compose -f docker-compose.prod.yml up -d --force-recreate app')
    expect(r.calls.at(-1)).toBe(`exec nginx-proxy grep -rqs ${FILE} /etc/nginx/conf.d/`)
    expect(r.out).toContain('готово')
  })

  it('уже настроено — приложение не пересоздаётся', () => {
    const r = proxyTimeout('DOMAIN=invoice.example.by\n', { env: { FAKE_CAT: 'proxy_read_timeout 400s;' } })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('уже настроено')
    expect(r.calls.some(c => c.startsWith('compose'))).toBe(false)
    expect(r.calls.some(c => c.includes('sh -c'))).toBe(false)
  })

  it('прокси не перестроил конфиг — предупреждение и ошибка, а не «готово»', () => {
    const r = proxyTimeout('DOMAIN=invoice.example.by\n', { env: { FAKE_GREP: '1' } })
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('ещё не перестроил конфиг')
  })

  it.each([
    ['нет прокси', 'watchtower containrrr/watchtower\\n', 0],
    ['два прокси', 'p1 nginxproxy/nginx-proxy\\np2 jwilder/nginx-proxy\\n', 2]
  ])('%s — просит PROXY=<имя> и ничего не пишет', (_label, ps, n) => {
    const r = proxyTimeout('DOMAIN=invoice.example.by\n', { env: { FAKE_PS: ps } })
    expect(r.code).not.toBe(0)
    expect(r.out).toContain(`контейнеров nginx-proxy найдено: ${n}`)
    expect(r.calls.some(c => c.startsWith('exec') || c.startsWith('compose'))).toBe(false)
  })

  it('PROXY=<имя> — берётся указанный контейнер', () => {
    const r = proxyTimeout('DOMAIN=invoice.example.by\n', { args: ['PROXY=edge-proxy'], env: { FAKE_PS: '' } })
    expect(r.code, r.out).toBe(0)
    expect(r.calls[0]).toContain('exec edge-proxy')
  })

  it('DOMAIN из окружения оболочки не берётся — только ./.env или командная строка', () => {
    const fromEnv = proxyTimeout('DOMAIN=invoice.example.by\n', { env: { DOMAIN: 'bank-import.example.by' } })
    expect(fromEnv.out).toContain('домен: invoice.example.by')
    const fromArgs = proxyTimeout('DOMAIN=invoice.example.by\n', { args: ['DOMAIN=other.example.by'] })
    expect(fromArgs.out).toContain('домен: other.example.by')
  })

  // Находки ревью безопасности на #16: значения попадали в рецепт текстом.
  it.each([
    ['подстановка команды в домене', 'DOMAIN=x$(touch PWNED)y.by\n', []],
    ['обратные кавычки в домене', 'DOMAIN=x`touch PWNED`y.by\n', []],
    ['выход из vhost.d', 'DOMAIN=../../etc/nginx/nginx.conf\n', []],
    ['пробел внутри домена', 'DOMAIN=invoice exa.by\n', []],
    ['решётка без пробела', 'DOMAIN=invoice.example.by#x\n', []],
    ['пустой домен', 'DOMAIN=\n', []],
    ['нет .env', null, []],
    ['кавычка и команда в таймауте', 'DOMAIN=invoice.example.by\n', ['PROXY_TIMEOUT=1s\'; touch PWNED; echo \'']],
    ['таймаут без числа', 'DOMAIN=invoice.example.by\n', ['PROXY_TIMEOUT=long']],
    ['странное имя прокси', 'DOMAIN=invoice.example.by\n', ['PROXY=p;touch PWNED']]
  ])('%s — отказ до любого обращения к docker', (_label, dotenv, args) => {
    const r = proxyTimeout(dotenv, { args })
    expect(r.code).not.toBe(0)
    expect(r.calls).toEqual([])
    expect(existsSync(join(r.dir, 'PWNED'))).toBe(false)
  })
})
