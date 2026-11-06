// Favoritos por VPS: fixar pastas no Acesso rápido, persistir e usar como destino de arraste.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { callApi, dockerSh, fileList, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/fav'
const sh = (cmd) => dockerSh(A.name, cmd)
let app, win, errors, userData

const row = (name) => fileList(win).locator(`[data-path="${DIR}/${name}"]`)
const favorite = (path) => win.locator(`[data-favorite="${path}"]`)
const connect = async () => {
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, DIR).waitFor({ timeout: 30_000 })
}

before(async () => {
  sh(`rm -rf ${DIR} && mkdir -p ${DIR}/projeto ${DIR}/outra && echo x > ${DIR}/a.txt`)
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Fav', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  userData = first.userData
  ;({ app, win, errors } = await launchApp({ userData }))
  await connect()
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('adicionar uma pasta aos favoritos pelo menu mostra o atalho no Acesso rápido', async () => {
  await row('projeto').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Adicionar aos favoritos' }).click()
  await favorite(`${DIR}/projeto`).waitFor()
  await favorite(`${DIR}/projeto`).click()
  await fileList(win, `${DIR}/projeto`).waitFor()
})

test('a pasta atual também pode ser favoritada pelo menu do espaço vazio', async () => {
  await win.getByRole('button', { name: 'Pasta acima (Alt+↑)' }).click()
  await fileList(win, DIR).waitFor()
  await fileList(win).click({ button: 'right', position: { x: 300, y: 300 } })
  await win.getByRole('menuitem', { name: 'Adicionar aos favoritos' }).click()
  await favorite(`${DIR}/projeto`).waitFor()
  assert.equal(await win.locator('[data-favorite]').count(), 2)
})

test('soltar um item num favorito move para a pasta', async () => {
  await favorite(DIR).click()
  await fileList(win, DIR).waitFor()
  await row('a.txt').locator('[data-name-cell]').dragTo(favorite(`${DIR}/projeto`))
  await win.getByText('1 item(ns) movido(s) para projeto.').waitFor()
  assert.equal(sh(`test -e ${DIR}/projeto/a.txt && echo sim || echo nao`), 'sim')
})

test('os favoritos persistem ao reabrir o app e remover pelo menu funciona', async () => {
  await app.close()
  ;({ app, win, errors } = await launchApp({ userData }))
  await connect()
  await favorite(`${DIR}/projeto`).waitFor()
  await favorite(`${DIR}/projeto`).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Remover dos favoritos' }).click()
  await favorite(`${DIR}/projeto`).waitFor({ state: 'detached' })
  assert.equal(await win.locator('[data-favorite]').count(), 1)
})

test('a API ignora caminhos inválidos e repetidos', async () => {
  const id = (await callApi(win, 'connections.list')).data.find((c) => c.name === 'Fav').id
  const { data } = await callApi(win, 'connections.setFavorites', id, ['/a/../b', '/b', 'relativo', 42, '/c'])
  assert.deepEqual(data.favorites, ['/b', '/c'])
  assert.equal((await callApi(win, 'connections.setFavorites', id, 'nao-lista')).error, 'Lista de favoritos inválida.')
  await callApi(win, 'connections.setFavorites', id, [])
})
