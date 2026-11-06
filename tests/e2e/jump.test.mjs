// Jump host (ProxyJump): a VPS B é alcançada por dentro da VPS A (pela rede interna do Docker, onde só A é publicada
// para o app). Cobre jump desconectado (aberto só para isso), jump já conectado (reaproveitado), erros e ciclos.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'
import { callApi, dialogBox, dockerSh, eventually, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
const B = S.b
const sh = (container, cmd) => dockerSh(container.name, cmd)
/** Sessões SSH abertas no servidor (um sshd por sessão, com o usuário dev). */
const sessionsOn = (container) => Number(sh(container, `ps -o args | grep -c '[s]shd.*dev' || true`))
let app, win, errors, bastion, viaJump, bIp

const api = async (path, ...args) => {
  const r = await callApi(win, path, ...args)
  assert.equal(r.error, undefined, r.error)
  return r.data
}

before(async () => {
  bIp = execFileSync('docker', ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', B.name], { encoding: 'utf8' }).trim()
  sh(B, 'echo estou-na-b > /config/jump-marker')
  sh(A, 'rm -f /config/jump-marker')
  ;({ app, win, errors } = await launchApp())
  const common = { secret: S.password }
  bastion = await saveConnection(win, { name: 'Bastion', port: A.port, ...common })
  // Do ponto de vista da A, a B é um IP interno do Docker na porta 2222.
  viaJump = await saveConnection(win, { name: 'ViaJump', host: bIp, port: 2222, jumpId: bastion, ...common })
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('o formulário oferece os outros servidores como jump host', async () => {
  await win.getByRole('button', { name: 'Nova VPS' }).click()
  const select = win.getByLabel('Jump host')
  await select.waitFor()
  const options = await select.locator('option').allTextContents()
  assert.ok(options.some((o) => o.startsWith('Bastion')) && options.some((o) => o.startsWith('ViaJump')), options.join('|'))
  await win.keyboard.press('Escape')
})

test('conecta por um jump que não estava conectado e o fecha junto com a conexão', async () => {
  const before = sessionsOn(A)
  await api('session.connect', viaJump)
  assert.deepEqual((await api('fs.list', viaJump, '/config')).map((e) => e.name).filter((n) => n === 'jump-marker'), ['jump-marker'], 'é a VPS B')
  assert.ok(sessionsOn(A) > before, 'o jump foi aberto na A')
  await api('session.disconnect', viaJump)
  await eventually(() => assert.equal(sessionsOn(A), before))
})

test('reaproveita o jump quando ele já está conectado e não o derruba ao desconectar', async () => {
  await api('session.connect', bastion)
  const withBastion = sessionsOn(A)
  await api('session.connect', viaJump)
  assert.equal(sessionsOn(A), withBastion, 'nenhuma sessão nova na A')
  assert.ok((await api('fs.list', viaJump, '/config')).some((e) => e.name === 'jump-marker'))
  await api('session.disconnect', viaJump)
  await new Promise((r) => setTimeout(r, 500))
  assert.equal((await api('fs.list', bastion, '/config')).some((e) => e.name === 'jump-marker'), false, 'a Bastion segue conectada e é outra VPS')
  await api('session.disconnect', bastion)
})

test('testar a conexão também passa pelo jump', async () => {
  const r = await api('connections.test', { name: 'T', host: bIp, port: 2222, username: 'dev', auth: 'password', keyPath: '', initialPath: '', jumpId: bastion, color: '#3b82f6', tags: [], secret: S.password, rememberSecret: false })
  assert.ok(r.os)
})

test('jump sem senha salva pede para conectar a ele antes', async () => {
  const noSecret = await saveConnection(win, { name: 'SemSenha', port: A.port, rememberSecret: false, secret: S.password })
  const via = await saveConnection(win, { name: 'ViaSemSenha', host: bIp, port: 2222, jumpId: noSecret, secret: S.password })
  const r = await callApi(win, 'session.connect', via)
  assert.match(r.error, /Jump host "SemSenha" precisa de senha ou passphrase salva/)
  assert.equal(r.code, undefined, 'não dispara o pedido de senha do destino')
})

test('destino inalcançável pelo jump dá erro claro', async () => {
  const closedPort = await saveConnection(win, { name: 'PortaFechada', host: bIp, port: 2999, jumpId: bastion, secret: S.password })
  const r = await callApi(win, 'session.connect', closedPort)
  assert.match(r.error, /Jump host "Bastion" não conseguiu encaminhar até/)
})

test('ciclos e jump inexistente são recusados ao salvar', async () => {
  const save = (extra, id) =>
    win.evaluate(([f, id]) => window.vpsApi.connections.save({ name: 'X', host: 'h', port: 22, username: 'u', auth: 'password', keyPath: '', initialPath: '', color: '#3b82f6', tags: [], rememberSecret: false, ...f }, id).then(() => null, (e) => e.message), [extra, id])
  assert.equal(await save({ jumpId: bastion }, bastion), 'Os jump hosts formam um ciclo.', 'apontar para si mesmo')
  assert.equal(await save({ jumpId: viaJump }, bastion), 'Os jump hosts formam um ciclo.', 'A usa B, que usa A')
  assert.equal(await save({ jumpId: 'nao-existe' }), 'Jump host não encontrado.')
})

test('remover o jump faz quem o usava voltar a conectar direto', async () => {
  await api('connections.remove', bastion)
  const list = await api('connections.list')
  assert.equal(list.find((c) => c.id === viaJump).jumpId, '')
})
