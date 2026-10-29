// Diálogo de permissões e dono (chmod/chgrp), incluindo seleção múltipla e recursão.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'
import { callApi, dialogBox, dockerSh, fileList, launchApp, saveConnection, screenshot, state, waitForSsh } from './helpers.mjs'

const S = state()
const A = S.a
const sh = (cmd, user) => dockerSh(A.name, cmd, user)
const mode = (path) => sh(`stat -c %a ${path}`)
let app, win, errors, vpsId

const row = (name) => fileList(win).getByRole('option', { name, exact: false })
const perms = () => dialogBox(win, 'Permissões e dono')
const openDialog = async (...names) => {
  await row(names[0]).click()
  for (const n of names.slice(1)) await row(n).click({ modifiers: ['Control'] })
  await win.keyboard.press('Alt+Enter')
  await perms().waitFor()
}
const apply = async () => {
  await perms().getByRole('button', { name: 'Aplicar' }).click()
  await perms().waitFor({ state: 'detached' })
}

before(async () => {
  // Grupo extra para testar chgrp. Nesta imagem o próprio sshd roda como "dev" e as sessões herdam
  // os grupos dele, então o container é reiniciado para o sshd já subir no grupo novo.
  sh('addgroup web 2>/dev/null; addgroup dev web 2>/dev/null; true', '0')
  execFileSync('docker', ['restart', '-t', '0', A.name], { stdio: 'ignore' })
  await waitForSsh(A.port)
  sh('rm -rf /config/perm && mkdir -p /config/perm/site/css && cd /config/perm && echo a > a.txt && echo b > b.sh && chmod 644 a.txt && chmod 755 b.sh')
  sh('cd /config/perm/site && echo i > index.html && echo c > css/s.css && chmod 600 index.html css/s.css && chmod 700 . css')
  sh('echo r > /config/perm/root.txt', '0')
  // Cadastra a VPS e reabre o app para o Hub listá-la.
  const first = await launchApp()
  vpsId = await saveConnection(first.win, { name: 'Perm', port: A.port, initialPath: '/config/perm', secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, '/config/perm').waitFor({ timeout: 30_000 })
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('Alt+Enter abre o diálogo com as permissões atuais; atalho 600 aplica', async () => {
  await openDialog('a.txt')
  assert.equal(await perms().getByLabel('Permissão numérica').inputValue(), '644')
  assert.equal(await perms().getByLabel('Dono: Escrever').isChecked(), true)
  assert.equal(await perms().getByLabel('Outros: Escrever').isChecked(), false)
  await perms().getByRole('button', { name: '600' }).click()
  assert.equal(await perms().getByLabel('Outros: Ler').isChecked(), false)
  await screenshot(win, 'permissoes')
  await apply()
  assert.equal(mode('/config/perm/a.txt'), '600')
  await row('a.txt').getByText('-rw-------').waitFor()
})

test('seleção múltipla: bits diferentes ficam mistos e clicar muda só aquele bit', async () => {
  sh('chmod 644 /config/perm/a.txt')
  await win.keyboard.press('F5')
  await openDialog('a.txt', 'b.sh')
  const ownerExec = perms().getByLabel('Dono: Executar')
  assert.equal(await ownerExec.evaluate((el) => el.indeterminate), true, '644 x 755: executar fica misto')
  assert.equal(await perms().getByLabel('Permissão numérica').inputValue(), '')
  await perms().getByLabel('Grupo: Escrever').check()
  await apply()
  assert.deepEqual([mode('/config/perm/a.txt'), mode('/config/perm/b.sh')], ['664', '775'])
})

test('recursivo: número digitado vale por inteiro, filtrando pastas e arquivos', async () => {
  await openDialog('site')
  await perms().getByLabel('Permissão numérica').fill('755')
  await perms().getByLabel('Aplicar também a tudo dentro das pastas').check()
  await perms().getByRole('radio', { name: 'Só pastas' }).check()
  await apply()
  assert.deepEqual([mode('/config/perm/site'), mode('/config/perm/site/css'), mode('/config/perm/site/index.html')], ['755', '755', '600'])

  await openDialog('site')
  await perms().getByLabel('Permissão numérica').fill('644')
  await perms().getByLabel('Aplicar também a tudo dentro das pastas').check()
  await perms().getByRole('radio', { name: 'Só arquivos' }).check()
  await apply()
  assert.deepEqual(
    [mode('/config/perm/site'), mode('/config/perm/site/index.html'), mode('/config/perm/site/css/s.css')],
    ['755', '644', '644'],
    '644 absoluto nos arquivos, mesmo partindo de 600 e com a pasta em 755'
  )
})

test('troca o grupo; sem root, o campo de dono fica bloqueado', async () => {
  await openDialog('site')
  const owner = perms().getByRole('combobox', { name: 'Dono' })
  await perms().getByText('Só root pode trocar o dono.').waitFor()
  assert.equal(await owner.isDisabled(), true)
  await perms().getByRole('combobox', { name: 'Grupo' }).fill('web')
  await perms().getByLabel('Aplicar também a tudo dentro das pastas').check()
  await apply()
  assert.equal(sh('stat -c %G /config/perm/site /config/perm/site/css/s.css | sort -u'), 'web')
})

test('falha parcial é relatada e o restante é aplicado', async () => {
  await win.keyboard.press('F5')
  await openDialog('b.sh', 'root.txt')
  await perms().getByRole('button', { name: '600' }).click()
  await perms().getByRole('button', { name: 'Aplicar' }).click()
  await win.getByText(/Alguns itens não foram alterados/).waitFor()
  assert.equal(mode('/config/perm/b.sh'), '600', 'item permitido foi alterado')
  assert.equal(mode('/config/perm/root.txt'), '644', 'arquivo de root intacto')
  await perms().getByRole('button', { name: 'Cancelar' }).click()
})

test('recursão em pasta do sistema e nomes inválidos são recusados', async () => {
  const base = { set: 0o7, clear: 0, applyTo: 'all' }
  assert.match((await callApi(win, 'fs.setPermissions', vpsId, ['/etc'], { ...base, recursive: true })).error, /não pode ser alterado recursivamente/)
  const bad = await callApi(win, 'fs.setPermissions', vpsId, ['/config/perm/a.txt'], { ...base, recursive: false, group: 'web; rm -rf /' })
  assert.match(bad.error, /inválido/)
  assert.match((await callApi(win, 'fs.setPermissions', vpsId, ['/config/perm/a.txt'], { set: 0o4, clear: 0o4, applyTo: 'all', recursive: false })).error, /inválidas/)
})
