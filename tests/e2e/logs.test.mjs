// Logs ao vivo: `tail -F` de verdade para arquivos; `journalctl` e `docker` de mentira (os contêineres de teste
// não têm systemd nem Docker). Também confere que fechar a aba mata o processo no servidor.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { callApi, dockerSh, eventually, fileList, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/logs'
const root = (cmd) => dockerSh(A.name, cmd, '0')
const sh = (cmd) => dockerSh(A.name, cmd)
let app, win, errors, vpsId

const JOURNALCTL = `#!/bin/sh
echo "journal args: $*"
while true; do echo "tick"; sleep 1; done
`
const DOCKER = `#!/bin/sh
echo "docker args: $*"
`
const put = (path, script) => root(`echo '${Buffer.from(script).toString('base64')}' | base64 -d > ${path} && chmod 755 ${path}`)

/** Começa um fluxo pela API e junta o que chega em window.__logs[id]. */
async function stream(id, source) {
  await win.evaluate(
    ([id]) => {
      window.__logs ??= {}
      window.__logs[id] = { text: '', ended: false }
      window.vpsApi.logs.onData((i, c) => i === id && (window.__logs[id].text += c))
      window.vpsApi.logs.onEnd((i) => i === id && (window.__logs[id].ended = true))
    },
    [id]
  )
  return callApi(win, 'logs.start', id, vpsId, source)
}
const got = (id) => win.evaluate((id) => window.__logs[id], id)
/** Quantos processos do servidor têm uma linha de comando que combina com a regex (BusyBox `ps`). */
const running = (regex) => Number(sh(`ps -o args | grep -c '${regex}' || true`).trim())

before(async () => {
  sh(`rm -rf ${DIR} && mkdir -p ${DIR} && printf 'primeira\\nsegunda\\n' > ${DIR}/app.log`)
  put('/usr/local/bin/journalctl', JOURNALCTL)
  put('/usr/local/bin/docker', DOCKER)
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Logs', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar', exact: true }).click()
  await fileList(win, DIR).waitFor({ timeout: 30_000 })
  vpsId = (await callApi(win, 'connections.list')).data.find((c) => c.name === 'Logs').id
})
after(async () => {
  root('rm -f /usr/local/bin/journalctl /usr/local/bin/docker')
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('acompanhar arquivo ao vivo: mostra o final, recebe linhas novas e filtra', async () => {
  await fileList(win).locator(`[data-path="${DIR}/app.log"]`).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Acompanhar ao vivo' }).click()
  await win.getByRole('tab', { name: /app\.log/ }).waitFor()
  const log = win.getByRole('log', { name: 'Saída do log' })
  await eventually(async () => assert.equal(await log.textContent(), 'primeira\nsegunda'))
  await win.getByText('Ao vivo', { exact: true }).waitFor()

  sh(`echo 'ERRO: falhou' >> ${DIR}/app.log; echo 'terceira' >> ${DIR}/app.log`)
  await eventually(async () => assert.equal(await log.textContent(), 'primeira\nsegunda\nERRO: falhou\nterceira'))
  await win.getByLabel('Filtrar linhas').fill('erro')
  await eventually(async () => assert.equal(await log.textContent(), 'ERRO: falhou'))
  await win.getByLabel('Filtrar linhas').fill('')
})

test('pausar congela a tela, retomar mostra o que chegou, e limpar esvazia', async () => {
  const log = win.getByRole('log', { name: 'Saída do log' })
  await win.getByRole('button', { name: 'Pausar' }).click()
  sh(`echo 'durante a pausa' >> ${DIR}/app.log`)
  await new Promise((r) => setTimeout(r, 1500))
  assert.ok(!(await log.textContent()).includes('durante a pausa'))
  await win.getByRole('button', { name: 'Retomar' }).click()
  await eventually(async () => assert.ok((await log.textContent()).endsWith('durante a pausa')))
  await win.getByRole('button', { name: 'Limpar' }).click()
  assert.equal(await log.textContent(), '')
})

test('fechar a aba encerra o tail no servidor', async () => {
  assert.equal(running('^[t]ail -n 200 -F'), 1)
  await win.getByRole('button', { name: 'Fechar app.log' }).click()
  await eventually(() => assert.equal(running('^[t]ail -n 200 -F'), 0))
})

test('journal geral e de um serviço, e contêiner Docker', async () => {
  assert.equal((await stream('j1', { kind: 'journal' })).error, undefined)
  await eventually(async () => assert.match((await got('j1')).text, /journal args: -f -n 200 --no-pager\ntick/))
  assert.equal((await stream('j2', { kind: 'journal', unit: 'nginx.service' })).error, undefined)
  await eventually(async () => assert.match((await got('j2')).text, /journal args: -f -n 200 --no-pager -u nginx\.service/))
  assert.equal((await stream('d1', { kind: 'docker', container: 'web' })).error, undefined)
  await eventually(async () => assert.match((await got('d1')).text, /docker args: logs -f --tail 200 -- web/))
  // o docker de mentira termina sozinho: o fluxo avisa que acabou
  await eventually(async () => assert.equal((await got('d1')).ended, true))
})

test('parar um fluxo mata o processo no servidor', async () => {
  assert.ok(running('[j]ournalctl -f') >= 1)
  await win.evaluate(() => {
    window.vpsApi.logs.stop('j1')
    window.vpsApi.logs.stop('j2')
  })
  await eventually(() => assert.equal(running('[j]ournalctl -f'), 0))
})

test('fontes e nomes inválidos são recusados antes de chegar ao servidor', async () => {
  assert.equal((await stream('x1', { kind: 'journal', unit: 'x.service; reboot' })).error, 'Nome de serviço inválido.')
  assert.equal((await stream('x2', { kind: 'docker', container: '$(reboot)' })).error, 'Nome de contêiner inválido.')
  assert.equal((await stream('x3', { kind: 'shell', cmd: 'reboot' })).error, 'Fonte de log inválida.')
  assert.ok((await stream('x4', { kind: 'file', path: 'relativo/app.log' })).error)
})
