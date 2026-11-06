// Logs grandes: arquivos acima do limite do editor abrem como "final do arquivo", com seguir e filtro.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { callApi, dockerSh, eventually, fileList, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/tail'
const sh = (cmd) => dockerSh(A.name, cmd)
let app, win, errors, vpsId

const log = () => win.getByRole('log', { name: 'Conteúdo do arquivo' })

before(async () => {
  sh(`rm -rf ${DIR} && mkdir -p ${DIR} && seq 1 600000 | sed 's/^/linha /' > ${DIR}/grande.log && echo pequeno > ${DIR}/pequeno.log`)
  sh(`printf 'inicio\\n' > ${DIR}/binario.bin && head -c 6000000 /dev/zero >> ${DIR}/binario.bin`)
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Tail', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, DIR).waitFor({ timeout: 30_000 })
  vpsId = (await callApi(win, 'connections.list')).data.find((c) => c.name === 'Tail').id
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('a API devolve só o final, começando numa linha inteira, e o editor continua recusando o arquivo', async () => {
  assert.equal((await callApi(win, 'fs.read', vpsId, `${DIR}/grande.log`)).code, 'TOO_LARGE')
  const { data } = await callApi(win, 'fs.readTail', vpsId, `${DIR}/grande.log`)
  assert.equal(data.truncated, true)
  assert.ok(data.size > 5 * 1024 * 1024)
  assert.ok(data.content.length <= 512 * 1024)
  assert.match(data.content, /^linha \d+\n/, 'não começa no meio de uma linha')
  assert.ok(data.content.endsWith('linha 600000\n'))
  assert.equal((await callApi(win, 'fs.readTail', vpsId, `${DIR}/binario.bin`)).error, 'Arquivo binário não pode ser editado. Use "Baixar".')
})

test('duplo clique num arquivo grande abre o final dele, somente leitura', async () => {
  await fileList(win).locator(`[data-path="${DIR}/grande.log"] [data-name-cell]`).dblclick()
  await win.getByRole('tab', { name: /grande\.log/ }).waitFor()
  await eventually(async () => assert.ok((await log().textContent()).endsWith('linha 600000')))
  assert.equal(await win.locator('.monaco-editor').count(), 0, 'não abriu o editor')
  await win.getByText('somente leitura').waitFor()
  assert.equal(await log().evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), true, 'rolado até o fim')
})

test('seguir mostra as linhas novas sozinho e o filtro mostra só o que combina', async () => {
  sh(`echo 'ERRO: algo falhou' >> ${DIR}/grande.log; echo 'linha 600002' >> ${DIR}/grande.log`)
  await eventually(async () => assert.ok((await log().textContent()).endsWith('linha 600002')), 10_000)
  await win.getByLabel('Filtrar linhas').fill('erro')
  await eventually(async () => assert.equal(await log().textContent(), 'ERRO: algo falhou'))
  await win.getByText('1 linha(s) com "erro"').waitFor()
})

test('pausar para de atualizar e arquivos pequenos continuam abrindo no editor', async () => {
  await win.getByLabel('Filtrar linhas').fill('')
  await win.getByRole('button', { name: 'Seguir' }).click()
  await win.getByText('Atualização pausada').waitFor()
  sh(`echo 'linha nova depois da pausa' >> ${DIR}/grande.log`)
  await win.waitForTimeout(2600)
  assert.ok(!(await log().textContent()).includes('depois da pausa'))
  await win.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await eventually(async () => assert.ok((await log().textContent()).includes('depois da pausa')))

  await win.getByRole('tab', { name: 'Arquivos' }).click()
  await fileList(win).locator(`[data-path="${DIR}/pequeno.log"] [data-name-cell]`).dblclick()
  await win.locator('.monaco-editor').waitFor({ timeout: 15_000 })
})
