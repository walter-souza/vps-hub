// Túneis de porta (ssh -L): o destino é o próprio sshd da VPS (localhost:2222), que responde com o banner SSH.
import assert from 'node:assert/strict'
import { createServer, connect } from 'node:net'
import { after, before, test } from 'node:test'
import { callApi, eventually, fileList, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
const PORT = 24022
let app, win, errors, vpsId

const row = () => win.locator(`[data-tunnel="${PORT}"]`)

/** Conecta numa porta local e devolve o primeiro pedaço recebido (ou null se fechou sem dados). */
const firstBytes = (port) =>
  new Promise((resolve, reject) => {
    const sock = connect(port, '127.0.0.1')
    sock.once('data', (d) => (sock.destroy(), resolve(d.toString())))
    sock.once('close', () => resolve(null))
    sock.once('error', reject)
  })

before(async () => {
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Tunel', port: A.port, initialPath: '/config', secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar', exact: true }).click()
  await fileList(win, '/config').waitFor({ timeout: 30_000 })
  vpsId = (await callApi(win, 'connections.list')).data.find((c) => c.name === 'Tunel').id
  await win.getByRole('tab', { name: 'Painel' }).click()
  await win.getByRole('navigation', { name: 'Seções do painel' }).getByRole('button', { name: 'Túneis' }).click()
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('adiciona, inicia e usa um túnel: a porta local fala com o destino pela VPS', async () => {
  await win.getByLabel('Porta local').fill(String(PORT))
  await win.getByLabel('Host de destino').fill('localhost')
  await win.getByLabel('Porta de destino').fill('2222')
  await win.getByRole('button', { name: 'Adicionar túnel' }).click()
  await row().waitFor()
  await row().getByText('parado').waitFor()

  await win.getByRole('button', { name: `Iniciar túnel ${PORT}`, exact: true }).click()
  await row().getByText(/ativo · 0 conexão/).waitFor()
  assert.match(await firstBytes(PORT), /^SSH-2\.0-/)
  await eventually(async () => assert.match(await row().textContent(), /1 no total/))
})

test('os túneis ficam salvos na conexão e a porta só escuta em 127.0.0.1', async () => {
  const conn = (await callApi(win, 'connections.list')).data.find((c) => c.id === vpsId)
  assert.deepEqual(conn.tunnels.map((t) => [t.localPort, t.remoteHost, t.remotePort]), [[PORT, 'localhost', 2222]])
  // outra interface da máquina não deve aceitar: tenta pelo IP da rede local, se houver
  const { networkInterfaces } = await import('node:os')
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)
  if (lan) {
    const refused = await new Promise((resolve) => {
      const s = connect(PORT, lan.address)
      s.once('connect', () => (s.destroy(), resolve(false)))
      s.once('error', () => resolve(true))
    })
    assert.equal(refused, true, 'não escuta fora do loopback')
  }
})

test('parar o túnel fecha a porta e derruba as conexões abertas', async () => {
  const open = connect(PORT, '127.0.0.1')
  await new Promise((r) => open.once('data', r))
  const closed = new Promise((r) => open.once('close', r))
  await win.getByRole('button', { name: `Parar túnel ${PORT}`, exact: true }).click()
  await closed
  await row().getByText('parado').waitFor()
  await assert.rejects(firstBytes(PORT), { code: 'ECONNREFUSED' })
})

test('porta local ocupada e destino que recusa viram mensagens claras', async () => {
  const busy = createServer().listen(24033, '127.0.0.1')
  await new Promise((r) => busy.once('listening', r))
  const a = (await callApi(win, 'tunnels.add', vpsId, { localPort: 24033, remoteHost: 'localhost', remotePort: 2222 })).data
  const id = a.tunnels.find((t) => t.localPort === 24033).id
  assert.match((await callApi(win, 'tunnels.start', vpsId, id)).error, /A porta 24033 já está em uso/)
  busy.close()
  await callApi(win, 'tunnels.remove', vpsId, id)

  const b = (await callApi(win, 'tunnels.add', vpsId, { localPort: 24034, remoteHost: 'localhost', remotePort: 1 })).data
  const dead = b.tunnels.find((t) => t.localPort === 24034).id
  assert.equal((await callApi(win, 'tunnels.start', vpsId, dead)).error, undefined)
  assert.equal(await firstBytes(24034), null, 'a conexão é encerrada')
  await eventually(async () => assert.match((await callApi(win, 'tunnels.status', vpsId)).data[dead].error, /localhost:1/))
  await callApi(win, 'tunnels.remove', vpsId, dead)
})

test('entradas inválidas e porta repetida são recusadas', async () => {
  const add = async (def) => (await callApi(win, 'tunnels.add', vpsId, def)).error
  assert.equal(await add({ localPort: 0, remoteHost: 'h', remotePort: 1 }), 'Porta local inválida.')
  assert.equal(await add({ localPort: 1, remoteHost: 'h; reboot', remotePort: 1 }), 'Host de destino inválido.')
  assert.equal(await add({ localPort: 1, remoteHost: 'h', remotePort: 70000 }), 'Porta de destino inválida.')
  assert.match(await add({ localPort: PORT, remoteHost: 'h', remotePort: 1 }), /já tem um túnel/)
})

test('remover um túnel em execução o encerra', async () => {
  await win.getByRole('button', { name: `Iniciar túnel ${PORT}`, exact: true }).click()
  await row().getByText(/ativo/).waitFor()
  await win.getByRole('button', { name: `Remover túnel ${PORT}`, exact: true }).click()
  await row().waitFor({ state: 'detached' })
  await assert.rejects(firstBytes(PORT), { code: 'ECONNREFUSED' })
})
