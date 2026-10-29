// Busca por nome e conteúdo, com o grep do BusyBox (padrão do container) e com GNU grep (Ubuntu/Debian).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { callApi, dockerSh, fileList, launchApp, saveConnection, screenshot, state } from './helpers.mjs'

const S = state()
const A = S.a
const sh = (cmd, user) => dockerSh(A.name, cmd, user)
let app, win, errors, vpsId

const search = async (q) => {
  const r = await callApi(win, 'fs.search', vpsId, crypto.randomUUID(), { dir: '/config/proj', caseSensitive: false, skipHeavy: true, ...q })
  if (r.error) throw new Error(r.error)
  return r.data
}

before(async () => {
  sh('rm -rf /config/proj && mkdir -p /config/proj/src/config /config/proj/node_modules/lib /config/proj/big')
  sh(`printf 'linha1\\nlinha2\\nPORT=8080\\n' > /config/proj/.env`)
  sh(`printf 'a\\nb\\nc\\nd\\nconst port = 8080 // porta\\n' > '/config/proj/src/config/srv:1.js'`)
  sh(`echo 'PORT=8080' > /config/proj/node_modules/lib/config.js`)
  sh('echo Config > /config/proj/src/Config.md && echo x > /config/proj/src/config/app.conf')
  sh(`printf 'bin\\000PORT=8080' > /config/proj/data.bin`)
  sh(`head -c 6000000 /dev/zero | tr '\\000' a > /config/proj/huge.txt && echo PORT=8080 >> /config/proj/huge.txt`)
  sh('cd /config/proj/big && i=0; while [ $i -lt 3000 ]; do echo nada > f$i.txt; i=$((i+1)); done')
  ;({ app, win, errors } = await launchApp())
  vpsId = await saveConnection(win, { name: 'Busca', port: A.port, initialPath: '/config/proj', secret: S.password })
  await callApi(win, 'session.connect', vpsId)
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

function apiTests(flavor) {
  test('por nome: subpastas, maiúsculas e node_modules', async () => {
    let r = await search({ term: 'config', mode: 'name' })
    assert.deepEqual(r.results.map((x) => x.path).sort(), ['/config/proj/src/Config.md', '/config/proj/src/config'])
    r = await search({ term: 'config', mode: 'name', skipHeavy: false })
    assert.ok(r.results.some((x) => x.path.includes('node_modules')))
    r = await search({ term: 'Config', mode: 'name', caseSensitive: true })
    assert.deepEqual(r.results.map((x) => x.name), ['Config.md'])
  })

  test('por conteúdo: linha, trecho e arquivos ignorados', async () => {
    const r = await search({ term: '8080', mode: 'content' })
    const by = Object.fromEntries(r.results.map((x) => [x.name, x]))
    assert.deepEqual([by['.env']?.line, by['.env']?.preview], [3, 'PORT=8080'])
    assert.equal(by['srv:1.js']?.line, 5, 'arquivo com ":" no nome')
    assert.equal(by['huge.txt'], undefined, 'arquivo acima de 5 MB')
    assert.equal(by['config.js'], undefined, 'node_modules')
    if (flavor === 'gnu') assert.equal(by['data.bin'], undefined, 'binário (GNU grep -I)')
  })

  test('limita a 500 resultados', async () => {
    const r = await search({ term: 'f', mode: 'name' })
    assert.deepEqual([r.results.length, r.truncated], [500, true])
  })

  test('não executa comandos vindos do termo e recusa termo inválido', async () => {
    await search({ term: "'; touch /tmp/pwned; '", mode: 'content' })
    assert.equal(sh('test -e /tmp/pwned && echo sim || echo nao'), 'nao')
    const r = await callApi(win, 'fs.search', vpsId, 'x', { dir: '/config/proj', term: 'a\nb', mode: 'name', caseSensitive: false, skipHeavy: true })
    assert.equal(r.error, 'Termo de busca inválido.')
  })
}

describe('com o grep do BusyBox', () => apiTests('busybox'))

describe('interface', () => {
  test('Enter no filtro abre a busca e o resultado abre o editor na linha', async () => {
    await win.getByRole('button', { name: /^(Conectar|Abrir)$/ }).click()
    await fileList(win, '/config/proj').waitFor({ timeout: 30_000 })
    await win.getByLabel('Filtrar nesta pasta').fill('8080')
    await win.getByLabel('Filtrar nesta pasta').press('Enter')
    await win.getByRole('radio', { name: 'Conteúdo' }).click()
    await win.getByRole('button', { name: 'Buscar', exact: true }).click()
    const results = win.getByRole('listbox', { name: 'Resultados da busca' })
    await results.getByRole('option', { name: /srv:1\.js/ }).dblclick()
    await win.locator('.monaco-editor').waitFor()
    await screenshot(win, 'busca-editor')
    await win.waitForFunction(() => document.querySelector('.monaco-editor .line-numbers.active-line-number')?.textContent === '5')
  })

  test('"Abrir pasta que contém" navega e seleciona o item', async () => {
    await win.getByRole('tab', { name: 'Arquivos' }).click()
    await win.getByRole('listbox', { name: 'Resultados da busca' }).getByRole('option', { name: /\.env/ }).click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Abrir pasta que contém' }).click()
    await win.getByRole('option', { name: '.env', selected: true }).waitFor({ timeout: 5000 })
  })

  test('Ctrl+F abre a busca e cancelar encerra os processos no servidor', async () => {
    await win.keyboard.press('Control+f')
    await win.getByRole('radio', { name: 'Conteúdo' }).click()
    await win.getByLabel('Termo de busca').fill('inexistente-xyz')
    await win.getByRole('button', { name: 'Buscar', exact: true }).click()
    await win.getByRole('button', { name: 'Cancelar' }).click() // ~3000 arquivos no laço do BusyBox: dá tempo
    await win.getByText('Busca cancelada.').waitFor({ timeout: 10_000 })
    await new Promise((r) => setTimeout(r, 1500))
    assert.equal(sh("ps -o args | grep -c '[g]rep -n -m1' || true", '0'), '0')
  })
})

describe('com GNU grep', () => {
  before(() => sh('apk add --no-cache grep', '0'))
  apiTests('gnu')
})
