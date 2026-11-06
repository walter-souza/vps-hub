// Painel da VPS: métricas do servidor (CPU, memória, disco, rede) pela API e pela aba "Painel".
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'
import { callApi, eventually, fileList, screenshot, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
let app, win, errors, vpsId

before(async () => {
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Painel', port: A.port, initialPath: '/config', secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, '/config').waitFor({ timeout: 30_000 })
  vpsId = (await callApi(win, 'connections.list')).data.find((c) => c.name === 'Painel').id
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('a primeira leitura não tem taxas; a segunda mede CPU e rede e reflete uma carga real', async () => {
  const first = (await callApi(win, 'stats.get', vpsId)).data
  assert.equal(first.cpu.percent, null)
  assert.equal(first.network.rxRate, null)
  assert.ok(first.cpu.cores >= 1 && first.cpu.perCore.length === first.cpu.cores)

  // Um laço de 3 s no servidor entre as duas leituras.
  execFileSync('docker', ['exec', '-d', '-u', '1000', A.name, 'sh', '-c', 'timeout 3 sh -c "while :; do :; done"'])
  await new Promise((r) => setTimeout(r, 2500))
  const second = (await callApi(win, 'stats.get', vpsId)).data
  assert.ok(second.cpu.percent > 2 && second.cpu.percent <= 100, `CPU medida: ${second.cpu.percent}`)
  assert.ok(second.network.rxRate >= 0 && second.network.txRate >= 0)
  assert.ok(second.at > first.at)
})

test('memória, carga, uptime, discos e identificação vêm coerentes', async () => {
  const s = (await callApi(win, 'stats.get', vpsId)).data
  assert.ok(s.memory.total > 0 && s.memory.used > 0 && s.memory.used <= s.memory.total)
  assert.ok(s.memory.available <= s.memory.total)
  assert.equal(s.load.length, 3)
  assert.ok(s.load.every((n) => n >= 0))
  assert.ok(s.uptime > 0)
  assert.ok(s.hostname.length > 0 && s.kernel.length > 0)
  const root = s.disks.find((d) => d.mount === '/')
  assert.ok(root && root.total > 0 && root.used <= root.total, 'a raiz aparece nos discos')
  assert.ok(s.disks.every((d) => !d.filesystem.startsWith('/dev/loop')))
})

test('a aba Painel mostra os cartões e passa a ter CPU medida', async () => {
  await win.getByRole('tab', { name: 'Painel' }).click()
  for (const name of ['CPU', 'Memória', 'Rede', 'Disco']) await win.getByRole('region', { name }).waitFor()
  await eventually(async () => assert.notEqual(await win.getByRole('region', { name: 'CPU' }).locator('span').first().textContent(), '—'), 15_000)
  assert.ok((await win.getByRole('region', { name: 'Memória' }).getByRole('progressbar').getAttribute('aria-valuenow')) !== null)
  await win.getByText('No ar há').waitFor()
  await win.waitForTimeout(5000) // algumas leituras para o gráfico
  await screenshot(win, 'painel')
  assert.ok((await win.getByRole('region', { name: 'Disco' }).getByRole('progressbar').count()) >= 1)
})

test('voltar para Arquivos mantém o painel montado mas o explorador visível', async () => {
  await win.getByRole('tab', { name: 'Arquivos' }).click()
  await fileList(win, '/config').waitFor()
  assert.equal(await win.getByRole('region', { name: 'CPU' }).isVisible(), false)
})
