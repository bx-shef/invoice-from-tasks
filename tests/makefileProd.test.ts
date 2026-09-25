// Makefile на сервере (docs/DEPLOY.md): цели `proxy-timeout`, `doctor`, `compose-update` и запуск compose.
//
// ⚠ Прогоняется НАСТОЯЩИЙ make на тексте Makefile из репозитория, а не его пересказ: у рецептов
// три слоя экранирования (make → sh → sh внутри контейнера прокси), и копия в тесте разошлась бы с
// ними молча. docker подменён скриптом в PATH: он пишет вызовы в журнал, а скрипт, который цель
// выполняет внутри контейнера прокси (`sh -c …`), запускает по-настоящему во временном каталоге
// вместо корня контейнера — так проверяется и то, что станет с файлом vhost.d.

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const MAKEFILE = readFileSync(join(ROOT, 'Makefile'), 'utf8')

// Подставной docker на node: журнал вызовов, «контейнер прокси» — каталог FAKE_ROOT. Скрипт записи
// (`exec … sh -c`) и проверки (`exec … grep`) выполняются ПО-НАСТОЯЩЕМУ с теми аргументами, что
// передала цель, — пути подменяются на FAKE_ROOT. docker-gen повторяет шаблон nginx-proxy: include
// строится по файлам vhost.d, которые лежат в момент генерации, и `_location_override` хоста
// вытесняет его `_location`.
const FAKE_DOCKER = `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), cp = require('child_process')
const a = process.argv.slice(2), env = process.env, R = env.FAKE_ROOT
fs.appendFileSync(env.DOCKER_LOG, a.join(' ') + '\\n')
const nl = s => s.replace(/\\\\n/g, '\\n')
if (a[0] === 'ps') { process.stdout.write(nl(env.FAKE_PS)); process.exit(0) }
if (a[0] === 'inspect') {
  const j = a.join(' ')
  if (j.includes('.State.Status')) {
    if ((env.FAKE_STATE ?? 'running healthy') === '') process.exit(1)
    process.stdout.write((env.FAKE_STATE ?? 'running healthy') + '\\n')
  }
  if (j.includes('nginx-proxy.keepalive')) process.stdout.write((env.FAKE_KEEPALIVE ?? 'disabled') + '\\n')
  if (j.includes('Config.Env')) {
    if (!env.FAKE_VHOST) process.exit(1)
    process.stdout.write('PATH=/usr/bin\\nVIRTUAL_HOST=' + nl(env.FAKE_VHOST) + '\\nTRUST_PROXY=1\\n')
  }
  if (j.includes('Mounts') && (env.FAKE_MOUNTED ?? '1') === '1') process.stdout.write('/etc/nginx/vhost.d\\n/etc/nginx/certs\\n')
  process.exit(0)
}
if (a[0] === 'compose') {
  fs.appendFileSync(env.DOCKER_LOG, 'compose-env DOMAIN=' + (env.DOMAIN ?? 'unset') + ' KEY=' + (env.B24_TOKEN_ENC_KEY ?? 'unset') + '\\n')
  if (a.includes('config')) process.exit(Number(env.FAKE_CONFIG ?? 0))
  process.exit(0)
}
if (a[0] === 'exec') {
  const [cmd, ...rest] = a.slice(2)
  // Скрипт health, который doctor запускает node в контейнере приложения, — настоящий; fetch подменён.
  if (cmd === 'node') {
    const stub = 'globalThis.fetch = async () => { const h = process.env.FAKE_HEALTH; if (h === "down") throw new Error("down"); return { ok: true, json: async () => JSON.parse(h) } };'
    process.exit(cp.spawnSync(process.execPath, ['-e', stub + rest[1]], { stdio: 'inherit' }).status ?? 1)
  }
  if (cmd === 'cat') {
    try { process.stdout.write(fs.readFileSync(R + rest[0])) } catch { process.exit(1) }
    process.exit(0)
  }
  if (cmd === 'sh') process.exit(cp.spawnSync('sh', ['-c', rest[1], '_', R + rest[3], rest[4]], { stdio: 'inherit' }).status ?? 1)
  if (cmd === 'grep') {
    rest[rest.length - 1] = R + rest[rest.length - 1]
    process.exit(cp.spawnSync('grep', rest, { stdio: 'inherit' }).status ?? 2)
  }
  if (cmd === 'docker-gen') {
    if (env.FAKE_GEN_FAIL === '1') process.exit(1)
    const dir = R + '/etc/nginx/vhost.d'
    const lines = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      .filter(f => f.endsWith('_location') && f !== 'default_location')
      .map(f => fs.existsSync(path.join(dir, f + '_override')) ? 'include /etc/nginx/vhost.d/' + f + '_override;' : 'include /etc/nginx/vhost.d/' + f + ';')
    fs.mkdirSync(R + '/etc/nginx/conf.d', { recursive: true })
    fs.writeFileSync(R + '/etc/nginx/conf.d/default.conf', lines.join('\\n') + '\\n')
    process.exit(0)
  }
  if (cmd === 'nginx') process.exit(Number((rest[0] === '-t' ? env.FAKE_NGINX_T : env.FAKE_RELOAD) ?? 0))
}
process.exit(0)
`

// Хост: curl (скачивание из репозитория и https снаружи), openssl (сертификат), df (диск).
const FAKE_CURL = `#!/usr/bin/env node
const fs = require('fs'), a = process.argv.slice(2), env = process.env
const url = a.find(x => x.startsWith('https://')) ?? ''
fs.appendFileSync(env.DOCKER_LOG, 'curl ' + url + '\\n')
if (url.startsWith('https://raw.githubusercontent.com/')) {
  if (env.FAKE_DL === undefined) process.exit(22)
  fs.writeFileSync(a[a.indexOf('-o') + 1], env.FAKE_DL)
  process.exit(0)
}
if (env.FAKE_EXT === undefined) { process.stderr.write('curl: (7) Failed to connect'); process.exit(7) }
process.stdout.write(env.FAKE_EXT)
`
const FAKE_OPENSSL = `#!/usr/bin/env node
const fs = require('fs'), a = process.argv.slice(2), env = process.env
const input = fs.readFileSync(0, 'utf8')
if (a[0] === 's_client') { process.stdout.write(env.FAKE_CERT ?? '-----BEGIN CERTIFICATE-----\\n'); process.exit(0) }
if (!input.includes('BEGIN CERTIFICATE')) process.exit(1)
if (a.includes('-enddate')) process.stdout.write('notAfter=Dec 24 10:00:00 2026 GMT\\n')
if (a.includes('-checkend')) process.exit(env.FAKE_CERT_SOON === '1' ? 1 : 0)
`
const FAKE_DF = `#!/bin/sh
echo 'Filesystem 1024-blocks Used Available Capacity Mounted on'
echo "/dev/sda1 100 50 50 \${FAKE_DF_USED:-42}% /"
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

interface MakeOpts {
  args?: string[]
  env?: Record<string, string>
  /** Файлы в vhost.d прокси. */
  files?: Record<string, string>
  /** /etc/nginx/conf.d/default.conf прокси. */
  conf?: string
  noVhostDir?: boolean
  /** Файлы рядом с Makefile (каталог на сервере). */
  here?: Record<string, string>
}

function make(target: string, opts: MakeOpts = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'ift-make-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'Makefile'), MAKEFILE)
  const bin = join(dir, 'bin')
  const root = join(dir, 'proxy-root')
  mkdirSync(bin)
  mkdirSync(opts.noVhostDir ? root : join(root, VHOST_DIR), { recursive: true })
  for (const [name, text] of Object.entries(opts.files ?? {})) writeFileSync(join(root, VHOST_DIR, name), text)
  if (opts.conf !== undefined) {
    mkdirSync(join(root, '/etc/nginx/conf.d'), { recursive: true })
    writeFileSync(join(root, '/etc/nginx/conf.d/default.conf'), opts.conf)
  }
  for (const [name, text] of Object.entries(opts.here ?? {})) writeFileSync(join(dir, name), text)
  for (const [name, text] of [['docker', FAKE_DOCKER], ['curl', FAKE_CURL], ['openssl', FAKE_OPENSSL], ['df', FAKE_DF]] as const) {
    writeFileSync(join(bin, name), text)
    chmodSync(join(bin, name), 0o755)
  }
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
    expect(existsSync(join(r.root, `${FILE}.new`)), 'временный файл убран (mv, не cp)').toBe(false)
    expect(r.out).toContain('готово')
  })

  it('vhost.d у прокси ещё нет — каталог создаётся, файл пишется', () => {
    const r = proxyTimeout({ noVhostDir: true })
    expect(r.code, r.out).toBe(0)
    expect(vhostFile(r)).toBe('proxy_read_timeout 400s;\n')
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

  it('уже настроено — ничего не пишет и не перестраивает, только мягкий reload', () => {
    const r = proxyTimeout({
      files: { 'invoice.example.by_location': 'proxy_read_timeout 400s;\n' },
      conf: `include ${FILE};\n`
    })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('уже настроено')
    expect(r.calls.some(c => c.includes('sh -c') || c.includes('docker-gen'))).toBe(false)
    expect(r.calls).toEqual(expect.arrayContaining(['exec nginx-proxy nginx -t', 'exec nginx-proxy nginx -s reload']))
  })

  it('reload упал — ошибка; повторный запуск видит «уже настроено» и перечитывает конфиг', () => {
    const first = proxyTimeout({ env: { FAKE_RELOAD: '1' } })
    expect(first.code).not.toBe(0)
    expect(first.out).toContain('повторите make proxy-timeout')
    const again = proxyTimeout({
      files: { 'invoice.example.by_location': 'proxy_read_timeout 400s;\n' },
      conf: `include ${FILE};\n`,
      env: { FAKE_RELOAD: '1' }
    })
    expect(again.code, 'и в ветке «уже настроено» провал reload — не успех').not.toBe(0)
  })

  it('наш файл есть, но в конфиге подключён только соседний хост — перестраивает, а не «уже настроено»', () => {
    const r = proxyTimeout({
      files: { 'invoice.example.by_location': 'proxy_read_timeout 400s;\n', 'invoicexexample.by_location': 'gzip on;\n' },
      conf: 'include /etc/nginx/vhost.d/invoicexexample.by_location;\n'
    })
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('уже настроено')
    expect(r.calls).toContain('exec nginx-proxy docker-gen /app/nginx.tmpl /etc/nginx/conf.d/default.conf')
  })

  it('таймаут в файле только в комментарии — это не «уже настроено»', () => {
    const r = proxyTimeout({
      files: { 'invoice.example.by_location': '#proxy_read_timeout 400s;\n' },
      conf: `include ${FILE};\n`
    })
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('уже настроено')
    expect(vhostFile(r)).toBe('#proxy_read_timeout 400s;\nproxy_read_timeout 400s;\n')
  })

  it('nginx -t не прошёл — без reload и с ошибкой', () => {
    const r = proxyTimeout({ env: { FAKE_NGINX_T: '1' } })
    expect(r.code).not.toBe(0)
    expect(r.calls.some(c => c.includes('reload'))).toBe(false)
    expect(r.out).toContain('не перестроен')
  })

  it('для домена есть _location_override — файл не подключён: ошибка, а не «готово»', () => {
    // Соседний хост, отличающийся от нашего одной буквой на месте точки: подстрока или регулярное
    // выражение вместо точной строки include приняли бы его include за наш.
    const r = proxyTimeout({ files: { 'invoice.example.by_location_override': 'return 503;\n', 'invoicexexample.by_location': 'gzip on;\n' } })
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

  it('контейнер приложения не подменить ни командной строкой, ни MAKEFLAGS', () => {
    for (const r of [
      proxyTimeout({ args: ['APP_CONTAINER=evil'] }),
      proxyTimeout({ env: { MAKEFLAGS: 'APP_CONTAINER=evil' } })
    ]) {
      expect(r.code, r.out).toBe(0)
      expect(readFileSync(join(r.dir, 'docker.log'), 'utf8')).toMatch(/^inspect .* invoice-from-tasks$/m)
      expect(readFileSync(join(r.dir, 'docker.log'), 'utf8')).not.toContain('evil')
    }
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
    const name = /^override APP_CONTAINER := (\S+)$/m.exec(MAKEFILE)?.[1]
    const compose = readFileSync(join(ROOT, 'docker-compose.prod.yml'), 'utf8')
    expect(name).toBeTruthy()
    expect(compose).toMatch(new RegExp(`^ {4}container_name: ${name}$`, 'm'))
  })
})

// ─── make doctor ──────────────────────────────────────────────────────
// Здоровый сервер: прокси, Watchtower и приложение запущены; upstream без keepalive, таймаут подключён,
// health отвечает изнутри и снаружи, сертификат свежий, диск свободен. Каждый тест ломает одно.
const SHA = 'a8f2ef2b57059e518ff1f14a880dcee79dd41d00'
const HEALTH = (config: Record<string, boolean> = {}) => JSON.stringify({
  ok: true,
  commit: SHA,
  config: { siteUrl: true, oauth: true, tokenKey: true, appCode: true, trustProxy: true, bitrixGpt: true, ...config },
  request: { forwardedFor: 'used' }
})
const UPSTREAM = (extra = '') => `upstream invoice.example.by {\n    # Container: invoice-from-tasks\n    server 172.18.0.14:3000;\n${extra}}\n`
const HEALTHY: MakeOpts = {
  env: {
    FAKE_PS: `${ONE_PROXY}watchtower containrrr/watchtower:latest\\n`,
    FAKE_HEALTH: HEALTH(),
    FAKE_EXT: HEALTH()
  },
  files: { 'invoice.example.by_location': 'proxy_read_timeout 400s;\n' },
  conf: `${UPSTREAM()}server {\n    location / {\n        include ${FILE};\n    }\n}\n`
}
const doctor = (patch: MakeOpts = {}) => make('doctor', {
  ...HEALTHY,
  ...patch,
  env: { ...HEALTHY.env, ...patch.env },
  files: patch.files ?? HEALTHY.files
})
const failures = (r: Run) => r.out.split('\n').filter(l => l.startsWith('  ✗'))

describe('make doctor', () => {
  it('здоровый сервер — все проверки ✓, код 0; сборка — первые 7 знаков коммита', () => {
    const r = doctor()
    expect(r.code, r.out).toBe(0)
    expect(failures(r)).toEqual([])
    for (const line of [
      '✓ контейнер invoice-from-tasks работает, healthcheck зелёный',
      `✓ настройки сервера заданы, сборка ${SHA.slice(0, 7)}`,
      '✓ у контейнера метка keepalive=disabled',
      '✓ прокси nginx-proxy ходит в приложение без keepalive',
      '✓ таймаут прокси для invoice.example.by: 400s',
      '✓ https://invoice.example.by отвечает, адрес клиента виден через прокси',
      '✓ сертификат действует до Dec 24 10:00:00 2026 GMT',
      '✓ Watchtower запущен',
      '✓ диск docker занят на 42%'
    ]) expect(r.out).toContain(line)
    expect(r.out).toContain('[make] всё в порядке')
  })

  it('только читает: ни записи в прокси, ни перезапуска прокси или приложения', () => {
    const r = doctor()
    const actions = r.calls.filter(c => !c.startsWith('curl '))
    expect(actions.every(c => /^exec (invoice-from-tasks node -e |nginx-proxy cat \/etc\/nginx\/)/.test(c)), actions.join('\n')).toBe(true)
  })

  it('upstream прокси с keepalive — ✗ и код 1: это сегодняшний 502', () => {
    const r = doctor({ conf: `${UPSTREAM('    keepalive 2;\n')}server { include ${FILE}; }\n` })
    expect(r.code).not.toBe(0)
    expect(failures(r)).toEqual([expect.stringContaining('прокси nginx-proxy держит соединения с приложением (keepalive)')])
  })

  it('keepalive соседнего хоста — не наш: upstream ищется по точному имени домена', () => {
    const neighbour = 'upstream invoicexexample.by {\n    server 172.18.0.9:3000;\n    keepalive 2;\n}\n'
    const r = doctor({ conf: `${neighbour}${UPSTREAM()}server { include ${FILE}; }\n` })
    expect(failures(r)).toEqual([])
  })

  it('нет метки keepalive=disabled — ✗ со ссылкой на compose-update', () => {
    const r = doctor({ env: { FAKE_KEEPALIVE: '' } })
    expect(r.code).not.toBe(0)
    expect(failures(r)).toEqual([expect.stringContaining('make compose-update CONFIRM=1')])
  })

  it('upstream нашего домена в конфиге нет — ✗', () => {
    const r = doctor({ conf: `server { include ${FILE}; }\n` })
    expect(failures(r)).toEqual([expect.stringContaining('нет upstream invoice.example.by')])
  })

  it.each([
    ['файла таймаута нет', { files: {} }],
    ['таймаут только в комментарии', { files: { 'invoice.example.by_location': '#proxy_read_timeout 400s;\n' } }],
    ['файл есть, но не подключён', { conf: UPSTREAM() }]
  ])('%s — ✗ и совет make proxy-timeout', (_label, patch) => {
    const r = doctor(patch as MakeOpts)
    expect(r.code).not.toBe(0)
    expect(failures(r)).toEqual([expect.stringContaining('→ make proxy-timeout')])
  })

  it('контейнера нет — один ✗ и стоп: остальное проверять не на чем', () => {
    const r = doctor({ env: { FAKE_STATE: '' } })
    expect(r.code).not.toBe(0)
    expect(failures(r)).toEqual(['  ✗ контейнера invoice-from-tasks нет → make prod-up'])
    expect(r.calls).toEqual([])
  })

  it('контейнер нездоров — ✗ с его состоянием', () => {
    const r = doctor({ env: { FAKE_STATE: 'running unhealthy' } })
    expect(failures(r)).toEqual(['  ✗ контейнер invoice-from-tasks: running unhealthy → make logs'])
  })

  it('health называет незаданные переменные именами из .env', () => {
    const r = doctor({ env: { FAKE_HEALTH: HEALTH({ appCode: false, bitrixGpt: false }) } })
    expect(failures(r)).toEqual([expect.stringContaining('не задано в .env: B24_APP_CODE,VIBE_API_KEY')])
  })

  it('health изнутри не ответил — ✗', () => {
    const r = doctor({ env: { FAKE_HEALTH: 'down' } })
    expect(failures(r)).toEqual([expect.stringContaining('/api/health изнутри контейнера не ответил')])
  })

  it('https снаружи не отвечает — ✗ с ошибкой curl', () => {
    const r = doctor({ env: { FAKE_EXT: undefined as unknown as string } })
    expect(failures(r)).toEqual([expect.stringContaining('https://invoice.example.by/api/health не ответил: curl: (7)')])
  })

  it('снаружи отвечает, но адрес клиента не виден — ✗', () => {
    const r = doctor({ env: { FAKE_EXT: HEALTH().replace('"used"', '"absent"') } })
    expect(failures(r)).toEqual([expect.stringContaining('forwardedFor не used')])
  })

  it.each([
    ['истекает меньше чем через 14 дней', { FAKE_CERT_SOON: '1' }, 'истекает меньше чем через 14 дней'],
    ['не прочитан', { FAKE_CERT: '' }, 'не прочитан']
  ])('сертификат %s — ✗', (_label, env, text) => {
    const r = doctor({ env })
    expect(failures(r)).toEqual([expect.stringContaining(text)])
  })

  it('Watchtower не запущен — ✗', () => {
    const r = doctor({ env: { FAKE_PS: ONE_PROXY } })
    expect(failures(r)).toEqual([expect.stringContaining('Watchtower не запущен')])
  })

  it('диск занят на 90 % и больше — ✗', () => {
    const r = doctor({ env: { FAKE_DF_USED: '95' } })
    expect(failures(r)).toEqual([expect.stringContaining('диск docker занят на 95%')])
  })

  it('два прокси — ✗ с просьбой PROXY=<имя>, остальные проверки идут; PROXY из командной строки берётся', () => {
    const two = `p1 nginxproxy/nginx-proxy\\np2 jwilder/nginx-proxy\\nwatchtower containrrr/watchtower\\n`
    const r = doctor({ env: { FAKE_PS: two } })
    expect(failures(r)).toEqual([expect.stringContaining('найдено: 2. Укажите нужный: make doctor PROXY=<имя>')])
    expect(r.out).toContain('✓ https://invoice.example.by отвечает')
    const chosen = doctor({ env: { FAKE_PS: two }, args: ['PROXY=p1'] })
    expect(chosen.out).toContain('✓ прокси p1 ходит в приложение без keepalive')
  })

  it('подстановка команды в VIRTUAL_HOST — ✗ домена, в прокси и наружу не ходит', () => {
    const r = doctor({ env: { FAKE_VHOST: 'x$(touch PWNED)y.by' } })
    expect(r.code).not.toBe(0)
    expect(failures(r)).toEqual([expect.stringContaining('не похож на один домен')])
    expect(r.calls.some(c => c.includes(' cat ') || c.startsWith('curl '))).toBe(false)
    expect(existsSync(join(r.dir, 'PWNED'))).toBe(false)
  })
})

// ─── make compose-update ──────────────────────────────────────────────
describe('make compose-update', () => {
  const OLD = 'services:\n  app:\n    image: ghcr.io/bx-shef/invoice-from-tasks:latest\n'
  const NEW = `${OLD}    labels:\n      - "com.github.nginx-proxy.nginx-proxy.keepalive=disabled"\n`
  const update = (opts: MakeOpts = {}) => make('compose-update', { ...opts, here: { 'docker-compose.prod.yml': OLD, ...opts.here } })
  const current = (r: Run) => readFileSync(join(r.dir, 'docker-compose.prod.yml'), 'utf8')
  const leftovers = (r: Run) => readdirSync(r.dir).filter(f => f.startsWith('.docker-compose.prod.yml.'))

  it('без CONFIRM — показывает разницу и ничего не меняет', () => {
    const r = update({ env: { FAKE_DL: NEW } })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('+      - "com.github.nginx-proxy.nginx-proxy.keepalive=disabled"')
    expect(r.out).toContain('Заменить: make compose-update CONFIRM=1')
    expect(current(r)).toBe(OLD)
    expect(leftovers(r)).toEqual([])
  })

  it('CONFIRM=1 — заменяет и оставляет копию прежнего; скачанное проверено compose без DOMAIN из оболочки', () => {
    const r = update({ env: { FAKE_DL: NEW, DOMAIN: 'bank-import.example.by' }, args: ['CONFIRM=1'] })
    expect(r.code, r.out).toBe(0)
    expect(current(r)).toBe(NEW)
    const backups = readdirSync(r.dir).filter(f => f.startsWith('docker-compose.prod.yml.bak-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(r.dir, backups[0]!), 'utf8')).toBe(OLD)
    expect(r.calls).toContain('compose-env DOMAIN=unset KEY=unset')
    expect(r.calls).toContain('curl https://raw.githubusercontent.com/bx-shef/invoice-from-tasks/main/docker-compose.prod.yml')
    expect(leftovers(r)).toEqual([])
  })

  it('CONFIRM=1 из окружения оболочки — не считается', () => {
    const r = update({ env: { FAKE_DL: NEW, CONFIRM: '1' } })
    expect(r.code, r.out).toBe(0)
    expect(current(r)).toBe(OLD)
  })

  it('файл уже как в репозитории — так и говорит', () => {
    const r = update({ env: { FAKE_DL: OLD }, args: ['CONFIRM=1'] })
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('уже как в main')
    expect(readdirSync(r.dir).filter(f => f.includes('.bak-'))).toEqual([])
  })

  it.each([
    ['не скачался', {}],
    ['скачалась не compose-страница (404 и т. п.)', { FAKE_DL: '404: Not Found' }],
    ['compose его не принял', { FAKE_DL: NEW, FAKE_CONFIG: '1' }]
  ])('%s — ошибка, рабочий файл не тронут', (_label, env) => {
    const r = update({ env, args: ['CONFIRM=1'] })
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('рабочий не тронут')
    expect(current(r)).toBe(OLD)
    expect(leftovers(r)).toEqual([])
  })

  it('REF=<ветка> — берёт файл из неё', () => {
    const r = update({ env: { FAKE_DL: NEW }, args: ['REF=claude/some-branch'] })
    expect(r.calls).toContain('curl https://raw.githubusercontent.com/bx-shef/invoice-from-tasks/claude/some-branch/docker-compose.prod.yml')
  })
})
