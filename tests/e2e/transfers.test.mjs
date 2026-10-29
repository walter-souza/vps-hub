// Fila de transferências: cancelar no meio do arquivo e tentar de novo.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { callApi, dockerSh, eventually, fileList, launchApp, saveConnection, state, tempDir } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/transfers'
const sh = (cmd) => dockerSh(A.name, cmd)
const SIZE = 300 * 1024 * 1024
let app, win, errors, vpsId, local

before(async () => {
  sh(`rm -rf ${DIR} && mkdir -p ${DIR}`)
  local = tempDir('vpshub-tr-')
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Fila', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, DIR).waitFor({ timeout: 30_000 })
  vpsId = (await callApi(win, 'connections.list')).data.find((c) => c.name === 'Fila').id
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('cancelar interrompe o envio, não deixa arquivo pela metade e permite tentar de novo', async () => {
  const file = join(local, 'grande.bin')
  writeFileSync(file, Buffer.alloc(SIZE, 1))
  const upload = callApi(win, 'fs.upload', vpsId, [file], DIR)
  await win.getByRole('button', { name: 'Cancelar grande.bin' }).click()
  assert.deepEqual(await upload, { error: 'Transferência cancelada.', code: 'CANCELLED' })

  const row = win.getByRole('listitem').filter({ hasText: 'grande.bin' })
  await row.getByTitle('Cancelada').waitFor()
  await eventually(() => assert.equal(sh(`test -e ${DIR}/grande.bin && echo sim || echo nao`), 'nao'))

  await row.getByRole('button', { name: 'Tentar de novo grande.bin' }).click()
  await row.getByRole('button', { name: /Cancelar|Tentar/ }).waitFor({ state: 'detached', timeout: 60_000 })
  await eventually(() => assert.equal(sh(`wc -c < ${DIR}/grande.bin`), String(SIZE)), 60_000)
})

test('cancelar um download apaga o arquivo parcial', async () => {
  const dest = tempDir('vpshub-dl2-')
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, dest)
  const download = callApi(win, 'fs.download', vpsId, [`${DIR}/grande.bin`])
  await win.getByRole('button', { name: 'Cancelar grande.bin' }).click()
  assert.equal((await download).code, 'CANCELLED')
  const { readdirSync } = await import('node:fs')
  assert.deepEqual(readdirSync(dest), [])
})
