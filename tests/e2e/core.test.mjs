// Fluxo principal: cadastro, host key, explorer, editor, transferências, terminal, exclusão, queda e autenticação.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { answerPrompt, callApi, dialogBox, dockerSh, fileList, launchApp, screenshot, state, waitForSsh } from './helpers.mjs'

const S = state()
const A = S.a
const sh = (cmd) => dockerSh(A.name, cmd)
const DIR = '/config/projeto teste'
let app, win, errors, userData, downloadDir, vpsId

before(async () => {
  sh(`rm -rf "${DIR}"`)
  ;({ app, win, errors, userData, downloadDir } = await launchApp())
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('cadastra a VPS testando a conexão e confirmando a host key', async () => {
  await win.getByText('Nenhuma VPS cadastrada').waitFor()
  await win.getByRole('button', { name: 'Nova VPS' }).click()
  const form = dialogBox(win, 'Nova conexão')
  await form.getByPlaceholder('Produção API').fill('Teste Docker')
  await form.getByPlaceholder('203.0.113.10').fill('127.0.0.1')
  const inputs = form.locator('input')
  await inputs.nth(2).fill(String(A.port))
  await inputs.nth(3).fill('dev')
  await form.locator('input[type=password]').fill(S.password)
  await form.getByPlaceholder('prod, cliente-x').fill('dev, docker')
  await form.getByRole('button', { name: 'Testar conexão' }).click()
  await form.getByText(/Conectado: .*ms/).waitFor({ timeout: 30_000 })
  const boxes = await app.evaluate(() => globalThis.__boxes)
  assert.ok(boxes.some((m) => m.includes('Primeira conexão')), 'confirmação de host key exibida')
  await form.getByRole('button', { name: 'Salvar' }).click()
  await win.getByText('Teste Docker').waitFor()
  await win.getByText(/Online · \d+ ms/).waitFor({ timeout: 10_000 })
  await screenshot(win, 'hub')
})

test('a senha salva fica criptografada no disco', () => {
  assert.ok(!readFileSync(join(userData, 'vps-hub.json'), 'utf8').includes(S.password))
})

test('abre o workspace na home', async () => {
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, '/config').waitFor({ timeout: 30_000 })
  await win.getByRole('option', { name: /logs/ }).waitFor()
  vpsId = (await callApi(win, 'connections.list')).data[0].id
})

test('cria pasta com espaço e arquivo, edita e salva em UTF-8', async () => {
  await win.getByRole('button', { name: 'Nova pasta (Ctrl+Shift+N)' }).click()
  await answerPrompt(win, 'Nova pasta', 'projeto teste', 'Criar')
  await win.getByRole('option', { name: /projeto teste/ }).dblclick()
  await fileList(win, DIR).waitFor()
  await win.getByRole('button', { name: 'Novo arquivo' }).click()
  await answerPrompt(win, 'Novo arquivo', "app's.js", 'Criar')
  await win.getByRole('option', { name: /app's\.js/ }).dblclick()
  await win.locator('.monaco-editor').waitFor({ timeout: 15_000 })
  await win.locator('.monaco-editor .view-lines').click()
  await win.keyboard.type('console.log("olá VPS")')
  await win.getByText('● Não salvo').waitFor()
  await win.keyboard.press('Control+s')
  await win.getByText('Salvo', { exact: true }).waitFor()
  assert.equal(sh(`cat "${DIR}/app's.js"`), 'console.log("olá VPS")')
  await screenshot(win, 'editor')
})

test('avisa quando o arquivo mudou no servidor antes de salvar', async () => {
  sh(`sleep 1; echo externo >> "${DIR}/app's.js"`)
  await win.locator('.monaco-editor .view-lines').click()
  await win.keyboard.press('End')
  await win.keyboard.type(' // local')
  await win.keyboard.press('Control+s')
  const conflict = dialogBox(win, 'Arquivo alterado no servidor')
  await conflict.waitFor({ timeout: 8000 })
  await conflict.getByRole('button', { name: 'Cancelar' }).click()
})

test('fechar aba com alterações pede confirmação', async () => {
  await win.getByRole('button', { name: "Fechar app's.js" }).click()
  await dialogBox(win, /Fechar "app's\.js"\?/).getByRole('button', { name: 'Fechar sem salvar' }).click()
  await fileList(win, DIR).waitFor()
})

test('renomeia com F2', async () => {
  await win.getByRole('option', { name: /app's\.js/ }).click()
  await win.keyboard.press('F2')
  await answerPrompt(win, 'Renomear', 'renomeado.js', 'Renomear')
  await win.getByRole('option', { name: /renomeado\.js/ }).waitFor()
})

test('envia arquivo (mesma API do arrastar e soltar)', async () => {
  const local = join(downloadDir, 'upload.txt')
  writeFileSync(local, 'x'.repeat(300_000))
  assert.deepEqual(await callApi(win, 'fs.upload', vpsId, [local], DIR), { data: undefined })
  assert.equal(sh(`wc -c < "${DIR}/upload.txt"`), '300000')
  await win.getByText('Transferências').first().waitFor()
})

test('baixa arquivo pelo menu de contexto', async () => {
  await win.getByRole('button', { name: 'Atualizar (F5)' }).click()
  await win.getByRole('option', { name: /renomeado\.js/ }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Baixar' }).click()
  await win.getByText('Download concluído.').waitFor({ timeout: 15_000 })
  assert.ok(existsSync(join(downloadDir, 'renomeado.js')))
})

test('abre o terminal na pasta atual', async () => {
  await fileList(win).click({ button: 'right', position: { x: 300, y: 300 } })
  await win.getByRole('menuitem', { name: 'Abrir terminal aqui' }).click()
  await win.locator('.xterm').waitFor()
  await win.waitForTimeout(1500)
  await win.keyboard.type('pwd; echo FIM-$((20+22))\r')
  await win.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('FIM-42'), null, { timeout: 10_000 })
  assert.match(await win.locator('.xterm-rows').textContent(), /\/config\/projeto teste/)
  await screenshot(win, 'terminal')
})

test('Shift+Del exclui permanentemente e /etc é protegido', async () => {
  await win.getByRole('button', { name: 'Pasta acima (Alt+↑)' }).click()
  await fileList(win, '/config').waitFor()
  await win.getByRole('option', { name: /projeto teste/ }).click()
  await win.keyboard.press('Shift+Delete')
  await dialogBox(win, /Excluir "projeto teste" permanentemente\?/).getByRole('button', { name: 'Excluir permanentemente' }).click()
  await win.getByRole('option', { name: /projeto teste/ }).waitFor({ state: 'detached' })
  assert.equal(sh(`test -e "${DIR}" && echo sim || echo nao`), 'nao')
  const r = await callApi(win, 'fs.remove', vpsId, ['/etc'], true)
  assert.match(r.error, /não pode ser excluído/)
})

test('detecta queda da conexão e reconecta', async () => {
  execFileSync('docker', ['restart', '-t', '0', A.name], { stdio: 'ignore' })
  await win.getByText('A conexão com a VPS caiu.').waitFor({ timeout: 20_000 })
  await waitForSsh(A.port)
  await win.getByRole('button', { name: 'Reconectar' }).click()
  await win.getByText('A conexão com a VPS caiu.').waitFor({ state: 'detached', timeout: 20_000 })
})

test('chave com passphrase e mensagens de credencial errada', async () => {
  const input = { name: 'Chave', host: '127.0.0.1', port: A.port, username: 'dev', auth: 'key', keyPath: S.keyPath, initialPath: '', color: '#22c55e', tags: [], rememberSecret: false }
  assert.equal((await callApi(win, 'connections.test', input)).code, 'SECRET_REQUIRED')
  assert.match((await callApi(win, 'connections.test', { ...input, secret: S.passphrase })).data.os, /Alpine/)
  assert.match((await callApi(win, 'connections.test', { ...input, secret: 'errada' })).error, /passphrase incorreta/)
  const badPassword = await callApi(win, 'connections.test', { ...input, auth: 'password', secret: 'errada' })
  assert.equal(badPassword.error, 'Autenticação falhou: usuário, senha ou chave incorretos.')
})
