// Makefile на сервере (docs/DEPLOY.md): цель `proxy-timeout` и запуск compose.
//
// ⚠ Прогоняется НАСТОЯЩИЙ make на тексте Makefile из репозитория, а не его пересказ: у рецептов
// три слоя экранирования (make → sh → sh внутри контейнера прокси), и копия в тесте разошлась бы с
// ними молча. docker подменён скриптом в PATH: он пишет вызовы в журнал, а скрипт, который цель
// выполняет внутри контейнера прокси (`sh -c …`), запускает по-настоящему во временном каталоге
// вместо корня контейнера — так проверяется и то, что станет с файлом vhost.d.

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const MAKEFILE = readFileSync(join(ROOT, 'Makefile'), 'utf8')

const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$1" in
  ps) printf '%b' "$FAKE_PS" ;;
  inspect)
    case "$*" in
      *Config.Env*) [ -n "$FAKE_VHOST" ] || exit 1; printf 'PATH=/usr/bin\\nVIRTUAL_HOST=%b\\nTRUST_PROXY=1\\n' "$FAKE_VHOST" ;;
      *Mounts*) [ "\${FAKE_MOUNTED:-1}" = 1 ] && printf '/etc/nginx/vhost.d\\n/etc/nginx/certs\\n' ;;
    esac ;;
  exec)
    shift; shift
    case "$1" in
      sh) sh -c "$3" _ "$FAKE_ROOT$5" "$6" ;;
      grep)
        case "$*" in
          *include*) if [ -f "$DOCKER_LOG.gen" ]; then exit \${FAKE_GEN_INCLUDES:-0}; else exit \${FAKE_INCLUDED_BEFORE:-1}; fi ;;
          *) grep -qsxF "$3" "$FAKE_ROOT$4" ;;
        esac ;;
      docker-gen) touch "$DOCKER_LOG.gen"; exit \${FAKE_GEN_FAIL:-0} ;;
      nginx) [ "$2" = -t ] && exit \${FAKE_NGINX_T:-0} ;;
    esac ;;
  compose) printf 'compose-env DOMAIN=%s KEY=%s\\n' "\${DOMAIN-unset}" "\${B24_TOKEN_ENC_KEY-unset}" >> "$DOCKER_LOG" ;;
esac
exit 0
`

// Рядом с прокси — companion обоих поколений: старый образ тоже содержит «nginx-proxy» в имени.
const ONE_PROXY = 'nginx-proxy nginxproxy/nginx-proxy:1.7\\nnginx-proxy-acme nginxproxy/acme-companion:2.5\\nletsencrypt jrcs/letsencrypt-nginx-proxy-companion:latest\\ninvoice-from-tasks ghcr.io/bx-shef/invoice-from-tasks:latest\\n'
const VHOST_DIR = '/etc/nginx/vhost.d'
const FILE = `${VHOST_DIR}/invoice.example.by_location`

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface Run { code: number, out: string, calls: string[], dir: string, root: string }

function make(target: string, opts: { args?: string[], env?: Record<string, string>, files?: Record<string, string> } = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'ift-make-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'Makefile'), MAKEFILE)
  const bin = join(dir, 'bin')
  const root = join(dir, 'proxy-root')
  mkdirSync(bin)
  mkdirSync(join(root, VHOST_DIR), { recursive: true })
  for (const [name, text] of Object.entries(opts.files ?? {})) writeFileSync(join(root, VHOST_DIR, name), text)
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER)
  chmodSync(join(bin, 'docker'), 0o755)
  const log = join(dir, 'docker.log')
  writeFileSync(log, '')
  const env: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: dir,
    DOCKER_LOG: log,
    FAKE_ROOT: root,
    FAKE_PS: ONE_PROXY,
    FAKE_VHOST: 'invoice.example.by',
    ...opts.env
  }
  const res = spawnSync('make', ['--no-print-directory', target, ...(opts.args ?? [])], { cwd: dir, env, encoding: 'utf8' })
  const calls = readFileSync(log, 'utf8').split('\n').filter(l => l && !l.startsWith('ps ') && !l.startsWith('inspect '))
  return { code: res.status ?? -1, out: `${res.stdout}${res.stderr}`, calls, dir, root }
}

const proxyTimeout = (opts: Parameters<typeof make>[1] = {}) => make('proxy-timeout', opts)
const vhostFile = (r: Run) => readFileSync(join(r.root, FILE), 'utf8')

describe('make proxy-timeout', () => {
  it('домен — из VIRTUAL_HOST контейнера; пишет таймаут, перестраивает конфиг в прокси, приложение не трогает', () => {
    const r = proxyTimeout()
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('прокси: nginx-proxy, домен: invoice.example.by, таймаут: 400s')
    expect(vhostFile(r)).toBe('proxy_read_timeout 400s;\n')
    expect(r.calls).toEqual(expect.arrayContaining([
      'exec nginx-proxy docker-gen /app/nginx.tmpl /etc/nginx/conf.d/default.conf',
      'exec nginx-proxy nginx -t',
      'exec nginx-proxy nginx -s reload'
    ]))
    const order = ['docker-gen', 'nginx -t', 'nginx -s reload'].map(s => r.calls.findIndex(c => c.includes(s)))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(r.calls.some(c => c.startsWith('compose'))).toBe(false)
    expect(r.out).toContain('готово')
  })

  it('другие директивы в файле сохраняются, старый таймаут заменяется', () => {
    const r = proxyTimeout({ files: { 'invoice.example.by_location': 'client_max_body_size 50m;\nproxy_read_timeout 60s;\n' } })
    expect(r.code, r.out).toBe(0)
    expect(vhostFile(r)).toBe('client_max_body_size 50m;\nproxy_read_timeout 400s;\n')
  })

  it('новый файл начинается с default_location — общие настройки прокси не теряются', () => {
    const r = proxyTimeout({ files: { default_location: 'add_header X-Common 1;\n' } })
    expect(r.code, r.out).toBe(0)
    expect(vhostFile(r)).toBe('add_header X-Common 1;\nproxy_read_timeout 400s;\n')
  })

  it('уже настроено — ничего не пишет и не перестраивает', () => {
    const r = proxyTimeout({ files: { 'invoice.example.by_location': 'proxy_read_timeout 400s;\n' }, env: { FAKE_INCLUDED_BEFORE: '0' } })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('уже настроено')
    expect(r.calls.some(c => c.includes('sh -c') || c.includes('docker-gen') || c.includes('reload'))).toBe(false)
  })

  it('nginx -t не прошёл — без reload и с ошибкой', () => {
    const r = proxyTimeout({ env: { FAKE_NGINX_T: '1' } })
    expect(r.code).not.toBe(0)
    expect(r.calls.some(c => c.includes('reload'))).toBe(false)
    expect(r.out).toContain('не перестроен')
  })

  it('конфиг перестроен, но файл не подключён — ошибка, а не «готово»', () => {
    const r = proxyTimeout({ env: { FAKE_GEN_INCLUDES: '1' } })
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('не подключён')
  })

  it('vhost.d прокси не отдельный том — предупреждает', () => {
    const r = proxyTimeout({ env: { FAKE_MOUNTED: '0' } })
    expect(r.out).toContain('не отдельный том')
  })

  it('контейнер приложения не запущен — просит make prod-up', () => {
    const r = proxyTimeout({ env: { FAKE_VHOST: '' } })
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('сначала make prod-up')
    expect(r.calls).toEqual([])
  })

  it.each([
    ['нет прокси', 'watchtower containrrr/watchtower\\n', 0],
    ['два прокси', 'p1 nginxproxy/nginx-proxy\\np2 jwilder/nginx-proxy\\n', 2]
  ])('%s — просит PROXY=<имя> и ничего не пишет', (_label, ps, n) => {
    const r = proxyTimeout({ env: { FAKE_PS: ps } })
    expect(r.code).not.toBe(0)
    expect(r.out).toContain(`контейнеров nginx-proxy найдено: ${n}`)
    expect(r.calls).toEqual([])
  })

  it('PROXY=<имя> и PROXY_TIMEOUT=… из командной строки — берутся', () => {
    const r = proxyTimeout({ args: ['PROXY=edge-proxy', 'PROXY_TIMEOUT=600s'], env: { FAKE_PS: '' } })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('прокси: edge-proxy, домен: invoice.example.by, таймаут: 600s')
  })

  it('PROXY и PROXY_TIMEOUT из окружения оболочки — не берутся', () => {
    const r = proxyTimeout({ env: { PROXY: 'http://10.0.0.1:3128', PROXY_TIMEOUT: '1s' } })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('прокси: nginx-proxy, домен: invoice.example.by, таймаут: 400s')
  })

  // Находки ревью безопасности на #16: значения не должны становиться командами ни на хосте, ни в прокси.
  it.each([
    ['подстановка команды в VIRTUAL_HOST', { env: { FAKE_VHOST: 'x$(touch PWNED)y.by' } }],
    ['выход из vhost.d', { env: { FAKE_VHOST: '../../etc/nginx/nginx.conf' } }],
    ['несколько доменов через запятую', { env: { FAKE_VHOST: 'a.by,b.by' } }],
    ['кавычка и команда в таймауте', { args: ['PROXY_TIMEOUT=1s\'; touch PWNED; echo \''] }],
    ['перевод строки в таймауте', { args: ['PROXY_TIMEOUT=400s\n\'; touch PWNED; echo \''] }],
    ['таймаут без числа', { args: ['PROXY_TIMEOUT=long'] }],
    ['странное имя прокси', { args: ['PROXY=p;touch PWNED'] }]
  ])('%s — отказ до любой записи', (_label, opts) => {
    const r = proxyTimeout(opts)
    expect(r.code).not.toBe(0)
    expect(r.calls).toEqual([])
    expect(existsSync(join(r.dir, 'PWNED'))).toBe(false)
    expect(existsSync(join(r.root, 'PWNED'))).toBe(false)
  })
})

describe('make proxy-timeout: перевод строки в VIRTUAL_HOST', () => {
  it('берётся первая строка, хвост командой не становится', () => {
    const r = proxyTimeout({ env: { FAKE_VHOST: 'invoice.example.by\\nx; touch PWNED; y.by' } })
    expect(r.out).toContain('домен: invoice.example.by,')
    expect(existsSync(join(r.dir, 'PWNED'))).toBe(false)
    expect(existsSync(join(r.root, 'PWNED'))).toBe(false)
  })
})

describe('compose на сервере берёт окружение только из ./.env', () => {
  it('DOMAIN и ключ шифрования из оболочки до compose не доходят', () => {
    const r = make('prod-up', { env: { DOMAIN: 'bank-import.example.by', B24_TOKEN_ENC_KEY: 'neighbour' } })
    expect(r.code, r.out).toBe(0)
    expect(r.calls).toContain('compose-env DOMAIN=unset KEY=unset')
  })

  it('DOMAIN=… в командной строке make тоже не доходит', () => {
    const r = make('prod-up', { args: ['DOMAIN=bank-import.example.by'] })
    expect(r.calls).toContain('compose-env DOMAIN=unset KEY=unset')
  })

  it('имя контейнера в Makefile совпадает с container_name в docker-compose.prod.yml', () => {
    const name = /^APP_CONTAINER = (\S+)$/m.exec(MAKEFILE)?.[1]
    const compose = readFileSync(join(ROOT, 'docker-compose.prod.yml'), 'utf8')
    expect(name).toBeTruthy()
    expect(compose).toMatch(new RegExp(`^ {4}container_name: ${name}$`, 'm'))
  })
})
