// Copiar/recortar/colar na mesma VPS e entre duas VPS.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { callApi, dialogBox, dockerSh, eventually, fileList, launchApp, saveConnection, screenshot, state } from './helpers.mjs'

const S = state()
const onA = (cmd) => dockerSh(S.a.name, cmd)
const onB = (cmd) => dockerSh(S.b.name, cmd)
let app, win, errors
const ids = {}

const row = (name) => fileList(win).getByRole('option', { name })
const goTo = async (dir) => fileList(win, dir).waitFor({ timeout: 30_000 })
const openVps = async (name) => {
  await win.locator('div.group', { hasText: name }).getByRole('button', { name: /Conectar|Abrir/ }).click()
  await goTo('/config/w')
}

before(async () => {
  for (const sh of [onA, onB]) sh('rm -rf /config/w /config/.vpshub-trash; mkdir -p /config/w/destino')
  onA('mkdir -p /config/w/pasta/sub && echo raiz > /config/w/a.txt && echo fundo > /config/w/pasta/sub/f.txt && chmod 750 /config/w/pasta && ln -s sub/f.txt /config/w/pasta/link')
  // Cadastra as duas VPS e reabre o app para o Hub listá-las.
  const first = await launchApp()
  const base = { initialPath: '/config/w', secret: S.password }
  ids.a = await saveConnection(first.win, { ...base, name: 'VPS A', port: S.a.port })
  ids.b = await saveConnection(first.win, { ...base, name: 'VPS B', port: S.b.port, color: '#22c55e' })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByText('VPS A').waitFor()
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('colar na mesma pasta cria "nome - cópia" numerado', async () => {
  await openVps('VPS A')
  await row('a.txt').click()
  await win.keyboard.press('Control+c')
  await win.keyboard.press('Control+v')
  await row('a - cópia.txt').waitFor()
  await win.keyboard.press('Control+v')
  await row('a - cópia (2).txt').waitFor()
  assert.equal(onA('cat "/config/w/a - cópia (2).txt"'), 'raiz')
})

test('"Colar nesta pasta" copia a pasta com permissões e links', async () => {
  await row('pasta').click()
  await win.keyboard.press('Control+c')
  await row('destino').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Colar nesta pasta' }).click()
  await eventually(() => assert.equal(onA('cat /config/w/destino/pasta/sub/f.txt'), 'fundo'))
  assert.equal(onA('stat -c %a /config/w/destino/pasta'), '750')
  assert.equal(onA('readlink /config/w/destino/pasta/link'), 'sub/f.txt')
})

test('recusa colar uma pasta dentro dela mesma', async () => {
  await row('pasta').first().dblclick()
  await goTo('/config/w/pasta')
  await fileList(win).click({ button: 'right', position: { x: 300, y: 200 } })
  await win.getByRole('menuitem', { name: 'Colar' }).click()
  await win.getByText('Não é possível colar "pasta" dentro dela mesma.').waitFor()
  await win.getByRole('button', { name: 'Pasta acima (Alt+↑)' }).click()
  await goTo('/config/w')
})

test('recortar esmaece o item; colar move e limpa a área de transferência', async () => {
  await row('a - cópia.txt').click()
  await win.keyboard.press('Control+x')
  assert.equal(await row('a - cópia.txt').evaluate((el) => getComputedStyle(el).opacity), '0.5')
  await win.getByText('1 item(ns) recortado(s)').waitFor()
  await row('destino').dblclick()
  await goTo('/config/w/destino')
  await win.keyboard.press('Control+v')
  await row('a - cópia.txt').waitFor()
  assert.equal(onA('test -e "/config/w/a - cópia.txt" && echo sim || echo nao'), 'nao')
  assert.equal(await win.getByText(/recortado\(s\)/).count(), 0)
})

test('substituir ao colar manda a versão antiga para a lixeira', async () => {
  onA('echo antigo > /config/w/destino/a.txt')
  await win.getByRole('button', { name: 'Pasta acima (Alt+↑)' }).click()
  await goTo('/config/w')
  await row('a.txt').first().click()
  await win.keyboard.press('Control+c')
  await row('destino').dblclick()
  await goTo('/config/w/destino')
  await win.keyboard.press('Control+v')
  await dialogBox(win, 'Substituir itens existentes?').getByRole('button', { name: 'Substituir' }).click()
  await eventually(() => assert.equal(onA('cat /config/w/destino/a.txt'), 'raiz'))
  assert.equal(onA('cat /config/.vpshub-trash/*/a.txt'), 'antigo')
})

test('recortar /etc é bloqueado', async () => {
  const r = await callApi(win, 'fs.paste', ids.a, ['/etc'], ids.a, '/config/w', 'cut', false)
  assert.match(r.error, /não pode ser movido/)
})

test('copia uma pasta da VPS A para a VPS B', async () => {
  await win.getByRole('button', { name: 'Pasta acima (Alt+↑)' }).click()
  await goTo('/config/w')
  await row('pasta').click()
  await win.keyboard.press('Control+c')
  await win.getByRole('button', { name: 'Hub' }).locator('visible=true').click()
  await openVps('VPS B')
  await win.getByText('1 item(ns) copiado(s) de outra VPS').waitFor()
  await fileList(win).click({ button: 'right', position: { x: 300, y: 200 } })
  await win.getByRole('menuitem', { name: 'Colar' }).click()
  await row('pasta').waitFor({ timeout: 20_000 })
  assert.equal(onB('cat /config/w/pasta/sub/f.txt'), 'fundo')
  assert.equal(onB('stat -c %a /config/w/pasta'), '750')
  assert.equal(onB('readlink /config/w/pasta/link'), 'sub/f.txt')
  assert.equal(onA('test -d /config/w/pasta && echo sim'), 'sim', 'origem mantida')
  await screenshot(win, 'colar-entre-vps')
})

test('recortar entre VPS apaga a origem só depois de copiar', async () => {
  const r = await callApi(win, 'fs.paste', ids.a, ['/config/w/a.txt'], ids.b, '/config/w', 'cut', false)
  assert.deepEqual(r.data, ['/config/w/a.txt'])
  assert.equal(onB('cat /config/w/a.txt'), 'raiz')
  assert.equal(onA('test -e /config/w/a.txt && echo sim || echo nao'), 'nao')
})
