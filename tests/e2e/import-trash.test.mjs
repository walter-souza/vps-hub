// Importação do ~/.ssh/config (com um HOME falso) e lixeira na VPS.
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { answerPrompt, callApi, dialogBox, dockerSh, fileList, launchApp, screenshot, state, tempDir } from './helpers.mjs'

const S = state()
const A = S.a
const sh = (cmd, user) => dockerSh(A.name, cmd, user)
let app, win, errors, vpsId

before(async () => {
  sh('rm -rf /config/.vpshub-trash "/config/lixo pasta" /tmp/fora.txt', '0')
  // HOME falso: o app lê ~/.ssh/config daqui (no Windows, os.homedir() usa USERPROFILE).
  const home = tempDir('vpshub-home-')
  mkdirSync(join(home, '.ssh'))
  copyFileSync(S.keyPath, join(home, '.ssh', 'testkey'))
  writeFileSync(
    join(home, '.ssh', 'config'),
    `# comentário
Host vps
    HostName 127.0.0.1
    Port ${A.port}
    User dev
    IdentityFile ~/.ssh/testkey

Host web prod-*
    HostName 10.0.0.5

Host bastion
    HostName b.example.com
    ProxyJump jump

Host = "quoted"
    HostName=1.2.3.4

Match host vps
    User nope

Host *
    User padrao
    Port 2200
`
  )
  ;({ app, win, errors } = await launchApp({ env: { USERPROFILE: home, HOME: home } }))
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('lê o ~/.ssh/config com as regras do OpenSSH', async () => {
  const hosts = (await callApi(win, 'connections.readSshConfig')).data
  const by = Object.fromEntries(hosts.map((h) => [h.alias, h]))
  assert.deepEqual(hosts.map((h) => h.alias).sort(), ['bastion', 'quoted', 'vps', 'web'], 'aliases sem curingas')
  assert.deepEqual([by.vps.host, by.vps.port, by.vps.username, by.vps.auth], ['127.0.0.1', A.port, 'dev', 'key'])
  assert.ok(by.vps.keyPath.endsWith('testkey') && !by.vps.keyPath.includes('~'), 'IdentityFile com ~ expandido')
  assert.deepEqual([by.web.host, by.web.port, by.web.username, by.web.auth], ['10.0.0.5', 2200, 'padrao', 'password'], 'herda Host *')
  assert.equal(by.quoted.host, '1.2.3.4', 'aspas e "="')
  assert.match(by.bastion.warning, /ProxyJump/)
})

test('importa só os hosts selecionados e marca os já cadastrados', async () => {
  await win.getByRole('button', { name: 'Importar ~/.ssh/config' }).last().click()
  const dlg = dialogBox(win, 'Importar do ~/.ssh/config')
  await dlg.getByText('Usa ProxyJump').waitFor()
  const checkbox = (alias) => dlg.locator('li', { hasText: alias }).first().locator('input')
  assert.deepEqual([await checkbox('vps').isChecked(), await checkbox('web').isChecked(), await checkbox('bastion').isChecked()], [true, true, false])
  await checkbox('web').uncheck()
  await checkbox('quoted').uncheck()
  await dlg.getByRole('button', { name: /^Importar/ }).click()
  await win.getByText('1 conexão(ões) importada(s).').waitFor()

  await win.getByRole('button', { name: 'Importar ~/.ssh/config' }).click()
  await dialogBox(win, 'Importar do ~/.ssh/config').getByText('já cadastrada').waitFor()
  await dialogBox(win, 'Importar do ~/.ssh/config').getByRole('button', { name: 'Cancelar' }).click()
})

test('conecta com a chave importada pedindo a passphrase', async () => {
  await win.getByRole('button', { name: 'Conectar' }).click()
  const pass = dialogBox(win, 'Passphrase da chave SSH')
  await pass.locator('input').fill(S.passphrase)
  await pass.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, '/config').waitFor({ timeout: 30_000 })
  vpsId = (await callApi(win, 'connections.list')).data[0].id
})

const row = () => win.getByRole('option', { name: /lixo pasta/ })
const moveRowToTrash = async () => {
  await row().click()
  await win.keyboard.press('Delete')
  await dialogBox(win, 'Mover "lixo pasta" para a lixeira?').getByRole('button', { name: 'Mover para a lixeira' }).click()
  await row().waitFor({ state: 'detached' })
}

test('Del move para a lixeira e "Desfazer" restaura com o conteúdo', async () => {
  await win.getByRole('button', { name: 'Nova pasta (Ctrl+Shift+N)' }).click()
  await answerPrompt(win, 'Nova pasta', 'lixo pasta', 'Criar')
  sh('echo conteudo > "/config/lixo pasta/dentro.txt"')
  await moveRowToTrash()
  assert.match(sh('ls /config/.vpshub-trash/*/'), /lixo pasta/)
  await win.getByRole('button', { name: 'Desfazer' }).click()
  await row().waitFor()
  assert.equal(sh('cat "/config/lixo pasta/dentro.txt"'), 'conteudo')
})

test('mover para a lixeira falha com mensagem clara sem permissão', async () => {
  sh('echo x > /tmp/fora.txt', '0') // arquivo de root no /tmp (sticky): dev não pode movê-lo
  const r = await callApi(win, 'fs.remove', vpsId, ['/tmp/fora.txt'], false)
  assert.match(r.error, /Falha ao mover "fora\.txt" para a lixeira/)
  sh('rm -f /tmp/fora.txt', '0')
})

test('a tela da Lixeira mostra o local original e restaura', async () => {
  await moveRowToTrash()
  sh('echo x > /tmp/fora.txt')
  assert.equal((await callApi(win, 'fs.remove', vpsId, ['/tmp/fora.txt'], false)).data.length, 1)
  await win.getByRole('button', { name: 'Lixeira' }).click()
  const trash = win.getByRole('listbox', { name: 'Itens na lixeira' })
  await trash.getByText('/config/lixo pasta').waitFor()
  await trash.getByText('/tmp/fora.txt').waitFor()
  await screenshot(win, 'lixeira')
  await trash.getByRole('option', { name: /lixo pasta/ }).click()
  await win.getByRole('button', { name: 'Restaurar' }).click()
  await win.getByText('1 item(ns) restaurado(s).').waitFor()
})

test('restaurar não sobrescreve um item que já existe', async () => {
  sh('echo novo > /tmp/fora.txt')
  const trash = win.getByRole('listbox', { name: 'Itens na lixeira' })
  await trash.getByRole('option', { name: /fora\.txt/ }).click()
  await win.getByRole('button', { name: 'Restaurar' }).click()
  await win.getByText(/Já existe um item em \/tmp\/fora\.txt/).waitFor()
  assert.equal(sh('cat /tmp/fora.txt'), 'novo')
})

test('esvaziar a lixeira apaga no servidor', async () => {
  await win.getByRole('button', { name: 'Esvaziar lixeira' }).click()
  await dialogBox(win, 'Esvaziar a lixeira?').getByRole('button', { name: 'Esvaziar lixeira' }).click()
  await win.getByText('A lixeira está vazia.').waitFor()
  assert.equal(sh('ls -A /config/.vpshub-trash 2>/dev/null | wc -l'), '0')
})

test('Shift+Del apaga sem passar pela lixeira', async () => {
  await win.getByRole('button', { name: 'Home' }).click()
  await row().click()
  await win.keyboard.press('Shift+Delete')
  await dialogBox(win, 'Excluir "lixo pasta" permanentemente?').getByRole('button', { name: 'Excluir permanentemente' }).click()
  await row().waitFor({ state: 'detached' })
  assert.equal(sh('test -e "/config/lixo pasta" && echo sim || echo nao'), 'nao')
  assert.equal(sh('ls -A /config/.vpshub-trash 2>/dev/null | wc -l'), '0')
})

test('protege a home e rejeita id de lixeira malicioso', async () => {
  assert.match((await callApi(win, 'fs.remove', vpsId, ['/config'], false)).error, /não pode ser excluído/)
  assert.match((await callApi(win, 'trash.restore', vpsId, ['../../etc'])).error, /inválido/)
})
