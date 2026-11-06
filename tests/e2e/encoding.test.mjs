// Editor com arquivos que não são UTF-8: Windows-1252 e UTF-16 abrem, e voltam ao servidor na mesma codificação.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { callApi, dockerSh, eventually, fileList, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/enc'
const sh = (cmd) => dockerSh(A.name, cmd)
const hex = (path) => sh(`od -An -tx1 -v ${path} | tr -d ' \\n'`)
const put = (name, bytes) => sh(`echo '${Buffer.from(bytes).toString('base64')}' | base64 -d > ${DIR}/${name}`)
let app, win, errors, vpsId
const api = (path, ...args) => callApi(win, path, vpsId, ...args)

before(async () => {
  sh(`rm -rf ${DIR} && mkdir -p ${DIR}`)
  put('latin1.txt', Buffer.from('café ação\n', 'latin1'))
  put('utf16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('olá\n', 'utf16le')]))
  put('utf16be.txt', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('olá\n', 'utf16le').swap16()]))
  put('binario.bin', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02]))
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Enc', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, DIR).waitFor({ timeout: 30_000 })
  vpsId = (await callApi(win, 'connections.list')).data.find((c) => c.name === 'Enc').id
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('arquivo Windows-1252 é lido com acentos e regravado byte a byte na mesma codificação', async () => {
  const { data } = await api('fs.read', `${DIR}/latin1.txt`)
  assert.deepEqual({ content: data.content, encoding: data.encoding }, { content: 'café ação\n', encoding: 'windows-1252' })
  assert.equal((await api('fs.write', `${DIR}/latin1.txt`, 'café ação\n', data.mtime, 'windows-1252')).error, undefined)
  assert.equal(hex(`${DIR}/latin1.txt`), '636166e92061e7e36f0a', 'continua em latin1, não virou UTF-8')
  assert.equal((await api('fs.write', `${DIR}/latin1.txt`, 'preço €5\n', null, 'windows-1252')).error, undefined)
  assert.equal(hex(`${DIR}/latin1.txt`), '707265e76f2080350a', '€ existe em Windows-1252 (0x80)')
})

test('caractere que a codificação não suporta é recusado sem alterar o arquivo', async () => {
  const before = hex(`${DIR}/latin1.txt`)
  const r = await api('fs.write', `${DIR}/latin1.txt`, 'japonês 日本\n', null, 'windows-1252')
  assert.match(r.error, /não existe em Windows-1252/)
  assert.equal(hex(`${DIR}/latin1.txt`), before)
})

test('UTF-16 com BOM (LE e BE) é lido e regravado com o BOM e a mesma ordem de bytes', async () => {
  for (const [name, encoding, bytes] of [
    ['utf16.txt', 'utf-16le', 'fffe6f006c00e1000a00'],
    ['utf16be.txt', 'utf-16be', 'feff006f006c00e1000a']
  ]) {
    const { data } = await api('fs.read', `${DIR}/${name}`)
    assert.equal(data.encoding, encoding)
    assert.equal(data.content.replace('﻿', ''), 'olá\n')
    assert.equal((await api('fs.write', `${DIR}/${name}`, data.content, data.mtime, encoding)).error, undefined)
    assert.equal(hex(`${DIR}/${name}`), bytes)
  }
})

test('binário continua recusado e arquivos novos seguem em UTF-8', async () => {
  assert.match((await api('fs.read', `${DIR}/binario.bin`)).error, /binário/)
  await api('fs.createFile', `${DIR}/novo.txt`)
  await api('fs.write', `${DIR}/novo.txt`, 'ação\n', null)
  assert.equal(hex(`${DIR}/novo.txt`), '61c3a7c3a36f0a')
})

test('o editor mostra a codificação e salva em Windows-1252', async () => {
  await fileList(win).locator(`[data-path="${DIR}/latin1.txt"] [data-name-cell]`).dblclick()
  await win.getByRole('tab', { name: /latin1\.txt/ }).waitFor()
  await win.getByText('Windows-1252', { exact: true }).waitFor()
  await win.locator('.monaco-editor .view-lines').click()
  await win.keyboard.press('Control+End')
  await win.keyboard.insertText('fim')
  await win.getByText('● Não salvo').waitFor()
  await win.keyboard.press('Control+s')
  await win.getByText('Salvo', { exact: true }).waitFor()
  await eventually(() => assert.ok(hex(`${DIR}/latin1.txt`).endsWith('66696d'), 'texto novo gravado'))
  assert.ok(hex(`${DIR}/latin1.txt`).includes('e7'), 'acentos continuam em latin1')
})
