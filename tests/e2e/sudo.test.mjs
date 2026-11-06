// Modo sudo: SFTP e comandos como administrador, com sudo sem senha e com senha.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { answerPrompt, callApi, dialogBox, dockerSh, eventually, fileList, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/sudo'
const ROOT_DIR = '/opt/vpshub-sudo'
const sh = (cmd) => dockerSh(A.name, cmd)
const root = (cmd) => dockerSh(A.name, cmd, '0')
const sudoers = (rule) => root(`echo '${rule}' > /etc/sudoers.d/dev && chmod 440 /etc/sudoers.d/dev`)
let app, win, errors, vpsId

const toggle = (label) => win.getByRole('button', { name: label, exact: true })
const banner = () => win.getByRole('status').filter({ hasText: 'Modo sudo ativo' })
const api = async (path, ...args) => callApi(win, path, vpsId, ...args)

async function enableSudo() {
  await toggle('Ativar modo sudo').click()
  await dialogBox(win, 'Ativar o modo sudo?').getByRole('button', { name: 'Ativar' }).click()
}
async function disableSudo() {
  await banner().getByRole('button', { name: 'Desativar' }).click()
  await banner().waitFor({ state: 'detached' })
}

before(async () => {
  root('apk add --no-cache sudo >/dev/null 2>&1; true')
  root(`rm -rf ${ROOT_DIR} && mkdir -p ${ROOT_DIR} && echo original > ${ROOT_DIR}/dono-root.txt && chmod 644 ${ROOT_DIR}/dono-root.txt && echo segredo > ${ROOT_DIR}/lido-so-por-root.txt && chmod 600 ${ROOT_DIR}/lido-so-por-root.txt`)
  sh(`rm -rf ${DIR} /config/.vpshub-trash && mkdir -p ${DIR}`)
  sudoers('dev ALL=(ALL) NOPASSWD: ALL')
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Sudo', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, DIR).waitFor({ timeout: 30_000 })
  vpsId = (await callApi(win, 'connections.list')).data.find((c) => c.name === 'Sudo').id
})
after(async () => {
  root(`rm -f /etc/sudoers.d/dev; rm -rf ${ROOT_DIR}`)
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('sem o modo sudo, arquivos do root não podem ser lidos nem gravados', async () => {
  assert.match((await api('fs.read', `${ROOT_DIR}/lido-so-por-root.txt`)).error, /Permissão negada/)
  assert.match((await api('fs.write', `${ROOT_DIR}/dono-root.txt`, 'x', null)).error, /Permissão negada/)
})

test('sudo sem senha: o botão liga o modo, mostra o aviso e libera leitura, escrita e exclusão', async () => {
  await enableSudo()
  await banner().waitFor()
  assert.equal((await api('fs.read', `${ROOT_DIR}/lido-so-por-root.txt`)).data.content, 'segredo\n')

  await api('fs.write', `${ROOT_DIR}/dono-root.txt`, 'editado como root\n', null)
  assert.equal(root(`cat ${ROOT_DIR}/dono-root.txt`), 'editado como root')
  assert.equal(root(`stat -c %U ${ROOT_DIR}/dono-root.txt`), 'root', 'o dono continua root')

  assert.equal((await api('fs.mkdir', `${ROOT_DIR}/nova`)).error, undefined)
  assert.equal(root(`stat -c %U ${ROOT_DIR}/nova`), 'root', 'criado como root')
  assert.equal((await api('fs.rename', `${ROOT_DIR}/nova`, `${ROOT_DIR}/renomeada`)).error, undefined)
  assert.equal((await api('fs.setPermissions', [`${ROOT_DIR}/dono-root.txt`], { set: 0, clear: 0o044, recursive: false, applyTo: 'all' })).error, undefined)
  assert.equal(root(`stat -c %a ${ROOT_DIR}/dono-root.txt`), '600')
  assert.equal((await api('fs.setPermissions', [`${ROOT_DIR}/renomeada`], { set: 0, clear: 0, owner: 'dev', recursive: false, applyTo: 'all' })).error, undefined)
  assert.equal(root(`stat -c %U ${ROOT_DIR}/renomeada`), 'dev', 'chown como root')
})

test('com o modo sudo, excluir um item do root vai para a lixeira do usuário, que continua sendo dele', async () => {
  const { data } = await api('fs.remove', [`${ROOT_DIR}/lido-so-por-root.txt`], false)
  assert.equal(data.length, 1)
  assert.equal(root(`test -e ${ROOT_DIR}/lido-so-por-root.txt && echo sim || echo nao`), 'nao')
  assert.equal(root('stat -c %U /config/.vpshub-trash'), 'dev', 'a lixeira não pode ficar com dono root')
  assert.equal((await callApi(win, 'trash.restore', vpsId, data)).error, undefined)
  assert.equal(root(`cat ${ROOT_DIR}/lido-so-por-root.txt`), 'segredo')
})

test('desativar o modo sudo volta a negar o acesso', async () => {
  await disableSudo()
  assert.match((await api('fs.read', `${ROOT_DIR}/lido-so-por-root.txt`)).error, /Permissão negada/)
  assert.match((await api('fs.write', `${ROOT_DIR}/dono-root.txt`, 'x', null)).error, /Permissão negada/)
})

test('sudo com senha: pede a senha, recusa a errada e a senha certa liga o modo', async () => {
  sudoers('dev ALL=(ALL) ALL')
  await enableSudo()
  const prompt = dialogBox(win, 'Senha do sudo de dev@127.0.0.1')
  await prompt.locator('input').fill('errada')
  await prompt.getByRole('button', { name: 'Ativar modo sudo' }).click()
  await prompt.getByText('Senha do sudo incorreta.').waitFor()
  await prompt.locator('input').fill(S.password)
  await prompt.getByRole('button', { name: 'Ativar modo sudo' }).click()
  await prompt.waitFor({ state: 'detached' })
  await banner().waitFor()
  assert.equal((await api('fs.read', `${ROOT_DIR}/lido-so-por-root.txt`)).data.content, 'segredo\n')
  await api('fs.write', `${ROOT_DIR}/dono-root.txt`, 'com senha\n', null)
  assert.equal(root(`cat ${ROOT_DIR}/dono-root.txt`), 'com senha')
  await disableSudo()
})

test('usuário sem permissão de sudo recebe uma explicação', async () => {
  root('rm -f /etc/sudoers.d/dev')
  await enableSudo()
  // Sem regra nenhuma, o sudo -n só diz que precisa de senha; a negativa aparece ao digitar.
  await answerPrompt(win, 'Senha do sudo de dev@127.0.0.1', S.password, 'Ativar modo sudo')
  await win.getByText('Este usuário não tem permissão para usar sudo.').waitFor()
  assert.equal(await banner().count(), 0)
  await eventually(() => api('session.setSudo', false))
})
