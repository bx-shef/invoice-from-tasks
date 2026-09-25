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
  if (j.includes('Config.Env')) {
    if (!env.FAKE_VHOST) process.exit(1)
    process.stdout.write('PATH=/usr/bin\\nVIRTUAL_HOST=' + nl(env.FAKE_VHOST) + '\\nTRUST_PROXY=1\\n')
  }
  if (j.includes('Mounts') && (env.FAKE_MOUNTED ?? '1') === '1') process.stdout.write('/etc/nginx/vhost.d\\n/etc/nginx/certs\\n')
  process.exit(0)
}
if (a[0] === 'compose') {
  fs.appendFileSync(env.DOCKER_LOG, 'compose-env DOMAIN=' + (env.DOMAIN ?? 'unset') + ' KEY=' + (env.B24_TOKEN_ENC_KEY ?? 'unset') + '\\n')
  process.exit(0)
}
if (a[0] === 'exec') {
  const [cmd, ...rest] = a.slice(2)
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

// Рядом с прокси — companion обоих поколений: старый образ тоже содержит «nginx-proxy» в имени.
const ONE_PROXY = 'nginx-proxy nginxproxy/nginx-proxy:1.7\\nnginx-proxy-acme nginxproxy/acme-companion:2.5\\nletsencrypt jrcs/letsencrypt-nginx-proxy-companion:latest\\ninvoice-from-tasks ghcr.io/bx-shef/invoice-from-tasks:latest\\n'
const VHOST_DIR = '/etc/nginx/vhost.d'
const FILE = `${VHOST_DIR}/invoice.example.by_location`

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface Run { code: number, out: string, calls: string[], dir: string, root: string }

interface MakeOpts { args?: string[], env?: Record<string, string>, files?: Record<string, string>, conf?: string, noVhostDir?: boolean }

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
