// Dois painéis: duas pastas da mesma VPS lado a lado, com copiar/mover entre elas (menu e arrastar).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { dockerSh, eventually, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/dual'
const sh = (cmd) => dockerSh(A.name, cmd)
const exists = (path) => sh(`test -e "${path}" && echo sim || echo nao`) === 'sim'
let app, win, errors

const left = () => win.getByRole('listbox', { name: /^Arquivos em / }).first()
const right = () => win.getByRole('region', { name: 'Segundo painel' }).getByRole('listbox', { name: /^Arquivos em / })
const item = (pane, path) => pane().locator(`[data-path="${path}"]`)
const nameCell = (pane, path) => item(pane, path).locator('[data-name-cell]')

before(async () => {
  sh(`rm -rf ${DIR} /config/.vpshub-trash && mkdir -p ${DIR}/a ${DIR}/b && cd ${DIR}/a && echo x > x.txt && echo y > y.txt && echo z > z.txt`)
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Dual', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar', exact: true }).click()
  await left().waitFor({ timeout: 30_000 })
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('abre o segundo painel e cada um navega sozinho', async () => {
  assert.equal(await win.getByRole('region', { name: 'Segundo painel' }).count(), 0)
  await win.getByRole('button', { name: 'Dois painéis' }).click()
  await right().waitFor()
  await nameCell(left, `${DIR}/a`).dblclick()
  await win.getByRole('listbox', { name: `Arquivos em ${DIR}/a`, exact: true }).waitFor()
  await nameCell(right, `${DIR}/b`).dblclick()
  await win.getByRole('listbox', { name: `Arquivos em ${DIR}/b`, exact: true }).waitFor()
  await item(left, `${DIR}/a/x.txt`).waitFor()
  assert.equal(await item(right, `${DIR}/a/x.txt`).count(), 0)
})

test('copiar e mover para o outro painel (menu) atualizam os dois lados', async () => {
  await item(left, `${DIR}/a/x.txt`).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Copiar para o outro painel' }).click()
  await item(right, `${DIR}/b/x.txt`).waitFor()
  assert.ok(exists(`${DIR}/a/x.txt`) && exists(`${DIR}/b/x.txt`), 'copiar mantém o original')

  await item(left, `${DIR}/a/y.txt`).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Mover para o outro painel' }).click()
  await item(right, `${DIR}/b/y.txt`).waitFor()
  await item(left, `${DIR}/a/y.txt`).waitFor({ state: 'detached' })
  assert.ok(!exists(`${DIR}/a/y.txt`) && exists(`${DIR}/b/y.txt`))
})

test('arrastar de um painel para o outro move o item', async () => {
  await nameCell(left, `${DIR}/a/z.txt`).dragTo(right())
  await item(right, `${DIR}/b/z.txt`).waitFor()
  await item(left, `${DIR}/a/z.txt`).waitFor({ state: 'detached' })
  assert.ok(!exists(`${DIR}/a/z.txt`) && exists(`${DIR}/b/z.txt`))
})

test('atualizar um painel recarrega o outro quando ambos mostram a mesma pasta', async () => {
  // o segundo painel vai para a pasta do primeiro; o que mudar num aparece no outro
  await win.getByRole('button', { name: /^Pasta acima/ }).last().click()
  await nameCell(right, `${DIR}/a`).dblclick()
  await win.getByRole('listbox', { name: `Arquivos em ${DIR}/a`, exact: true }).nth(1).waitFor()
  sh(`rm -f ${DIR}/a/x.txt`)
  await left().click({ button: 'right', position: { x: 300, y: 300 } })
  await win.getByRole('menuitem', { name: 'Atualizar' }).click()
  await eventually(async () => assert.equal(await item(right, `${DIR}/a/x.txt`).count(), 0))
})

test('esconder o segundo painel volta a um só', async () => {
  await win.getByRole('button', { name: 'Dois painéis' }).click()
  await win.getByRole('region', { name: 'Segundo painel' }).waitFor({ state: 'hidden' })
  await win.getByRole('button', { name: 'Dois painéis' }).click()
  await right().waitFor()
})
