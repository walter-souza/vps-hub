// Visualizador de imagens: abrir, zoom, SVG sem executar script, limite de tamanho.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { dockerSh, fileList, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/viewer'
const sh = (cmd) => dockerSh(A.name, cmd)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let app, win, errors

const row = (name) => fileList(win).locator(`[data-path="${DIR}/${name}"] [data-name-cell]`)

before(async () => {
  sh(`rm -rf ${DIR} && mkdir -p ${DIR} && cd ${DIR} && echo ${PNG} | base64 -d > pixel.png`)
  sh(`cd ${DIR} && echo '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><script>window.__pwned=1</script><rect width="40" height="20"/></svg>' > logo.svg`)
  sh(`cd ${DIR} && head -c 26214500 /dev/zero > enorme.png && echo 'nao e imagem' > falso.txt`)
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Viewer', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, DIR).waitFor({ timeout: 30_000 })
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('duplo clique numa imagem abre o visualizador com dimensões e tamanho', async () => {
  await row('pixel.png').dblclick()
  await win.getByRole('tab', { name: /pixel\.png/ }).waitFor()
  await win.getByText('1 × 1 px').waitFor()
  assert.equal(await win.locator('img[alt="pixel.png"]').evaluate((el) => el.naturalWidth), 1)
  assert.equal(await win.locator('.monaco-editor').count(), 0, 'não abriu o editor')
})

test('zoom: 100% define o tamanho real e ajustar volta', async () => {
  await win.getByRole('button', { name: '100%' }).click()
  await win.getByLabel('Zoom').filter({ hasText: '100%' }).waitFor()
  await win.getByRole('button', { name: 'Aumentar zoom' }).click()
  await win.getByLabel('Zoom').filter({ hasText: '125%' }).waitFor()
  await win.getByRole('button', { name: 'Ajustar à janela' }).click()
  await win.getByLabel('Zoom').filter({ hasText: 'Ajustar' }).waitFor()
})

test('SVG é exibido como imagem, sem executar script, e "Ver código" abre o editor', async () => {
  await win.getByRole('tab', { name: 'Arquivos' }).click()
  await row('logo.svg').dblclick()
  await win.getByText('40 × 20 px').waitFor()
  assert.equal(await win.evaluate(() => window.__pwned), undefined, 'script do SVG não pode rodar')
  await win.getByRole('button', { name: 'Ver código' }).click()
  await win.locator('.monaco-editor').first().waitFor()
  await win.getByRole('tab', { name: /logo\.svg/ }).first().waitFor()
})

test('imagem acima do limite mostra erro; arquivo comum continua indo para o editor', async () => {
  await win.getByRole('tab', { name: 'Arquivos' }).click()
  await row('enorme.png').dblclick()
  await win.getByRole('alert').filter({ hasText: 'máx. 25 MB' }).waitFor({ timeout: 30_000 })
  await win.getByRole('tab', { name: 'Arquivos' }).click()
  await row('falso.txt').dblclick()
  await win.getByRole('tab', { name: /falso\.txt/ }).waitFor()
})

// ---------- Markdown ----------
test('Markdown abre com pré-visualização ao lado, atualizada ao digitar e sem HTML perigoso', async () => {
  sh(`cd ${DIR} && printf '# Titulo\n\n- [ ] tarefa\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>window.__md=1</script><img src=x onerror="window.__md=2">\n\n[site](https://example.com)\n' > LEIAME.md`)
  await win.getByRole('tab', { name: 'Arquivos' }).click()
  await win.getByRole('button', { name: 'Atualizar (F5)' }).click()
  await row('LEIAME.md').dblclick()
  const preview = win.getByRole('document', { name: 'Pré-visualização' })
  await preview.getByRole('heading', { name: 'Titulo' }).waitFor()
  assert.equal(await preview.locator('table td').count(), 2, 'tabela GFM')
  assert.equal(await preview.locator('input[type=checkbox]').count(), 1, 'lista de tarefas')
  assert.equal(await preview.locator('script').count(), 0)
  assert.equal(await win.evaluate(() => window.__md), undefined, 'script/onerror não podem rodar')

  await win.locator('.monaco-editor').first().click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.type('## Novo\n')
  await preview.getByRole('heading', { name: 'Novo' }).waitFor()
  await win.keyboard.press('Control+Z') // desfaz: arquivo sem alterações não bloqueia o fechamento do app
  await preview.getByRole('heading', { name: 'Novo' }).waitFor({ state: 'detached' })
  await win.locator('text=Não salvo').waitFor({ state: 'detached' })

  await preview.getByRole('link', { name: 'site' }).click()
  assert.ok(win.url().startsWith('file:'), 'clicar em link não navega a janela')

  await win.getByRole('button', { name: 'Pré-visualizar' }).click()
  await preview.waitFor({ state: 'detached' })
})
