// Seleção no estilo do Windows Explorer: retângulo, cliques com modificadores e teclado.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { dockerSh, fileList, launchApp, saveConnection, screenshot, state } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/sel'
const FILES = Array.from({ length: 40 }, (_, i) => `f${String(i + 1).padStart(2, '0')}.txt`)
let app, win, errors

const row = (name) => fileList(win).locator(`[data-path="${DIR}/${name}"]`)
const selectedNames = () =>
  fileList(win).locator('[role="option"][aria-selected="true"]').evaluateAll((els) => els.map((el) => el.dataset.path.split('/').pop()))
const focusedName = () => fileList(win).locator('[role="option"].outline').evaluateAll((els) => els.map((el) => el.dataset.path.split('/').pop())[0])
/** Ponto em branco da linha (coluna "Dono", fora do nome). */
const blankOf = async (name) => {
  const box = await row(name).boundingBox()
  return { x: box.x + box.width - 12, y: box.y + box.height / 2 }
}
const dragMarquee = async (from, to, { ctrl = false } = {}) => {
  if (ctrl) await win.keyboard.down('Control')
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(to.x, to.y, { steps: 8 })
  await win.mouse.up()
  if (ctrl) await win.keyboard.up('Control')
}

before(async () => {
  dockerSh(A.name, `rm -rf ${DIR} && mkdir -p ${DIR}/pasta && cd ${DIR} && for f in ${FILES.join(' ')}; do echo x > $f; done`)
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Sel', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, DIR).waitFor({ timeout: 30_000 })
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('retângulo a partir do espaço em branco seleciona as linhas tocadas', async () => {
  await dragMarquee(await blankOf('f03.txt'), await blankOf('f07.txt'))
  assert.deepEqual(await selectedNames(), ['f03.txt', 'f04.txt', 'f05.txt', 'f06.txt', 'f07.txt'])
})

test('Ctrl + retângulo inverte os itens tocados e mantém os demais', async () => {
  await dragMarquee(await blankOf('f05.txt'), await blankOf('f09.txt'), { ctrl: true })
  assert.deepEqual(await selectedNames(), ['f03.txt', 'f04.txt', 'f08.txt', 'f09.txt'])
})

test('clique no espaço em branco da linha seleciona só ela', async () => {
  const p = await blankOf('f12.txt')
  await win.mouse.click(p.x, p.y)
  assert.deepEqual(await selectedNames(), ['f12.txt'])
})

test('retângulo rola a lista sozinho ao passar da borda', async () => {
  const list = fileList(win)
  await list.evaluate((el) => (el.scrollTop = 0))
  const box = await list.boundingBox()
  const start = await blankOf('f01.txt')
  await win.mouse.move(start.x, start.y)
  await win.mouse.down()
  await win.mouse.move(start.x, box.y + box.height + 60, { steps: 5 })
  await win.waitForFunction(() => document.querySelector('[role="listbox"][aria-label^="Arquivos em"]:not(.hidden)')?.scrollTop > 200)
  await win.mouse.up()
  const names = await selectedNames()
  assert.ok(names.length > 20, `selecionou ${names.length} itens com rolagem`)
  assert.equal(names[0], 'f01.txt')
  await screenshot(win, 'selecao-retangulo')
})

test('clique simples num item da seleção múltipla só reduz ao soltar', async () => {
  await row('f02.txt').locator('[data-name-cell]').click()
  await row('f04.txt').locator('[data-name-cell]').click({ modifiers: ['Shift'] })
  assert.deepEqual(await selectedNames(), ['f02.txt', 'f03.txt', 'f04.txt'])
  await row('f03.txt').locator('[data-name-cell]').click()
  assert.deepEqual(await selectedNames(), ['f03.txt'])
})

test('Home, End, Shift+Home e PageDown', async () => {
  await win.keyboard.press('End')
  assert.deepEqual(await selectedNames(), ['f40.txt'])
  await win.keyboard.press('Home')
  assert.deepEqual(await selectedNames(), ['pasta'])
  await win.keyboard.press('PageDown')
  const afterPage = await selectedNames()
  assert.equal(afterPage.length, 1)
  assert.ok(FILES.indexOf(afterPage[0]) > 5, `PageDown pulou para ${afterPage[0]}`)
  await win.keyboard.press('Shift+Home')
  assert.equal((await selectedNames())[0], 'pasta')
  assert.equal((await selectedNames()).length, FILES.indexOf(afterPage[0]) + 2)
})

test('digitar pula para o item pelo começo do nome', async () => {
  await win.keyboard.type('f2')
  assert.deepEqual(await selectedNames(), ['f20.txt'])
  await new Promise((r) => setTimeout(r, 1100))
  await win.keyboard.type('p')
  assert.deepEqual(await selectedNames(), ['pasta'])
})

test('Ctrl+setas movem só o foco e Ctrl+Espaço marca o item focado', async () => {
  await row('f10.txt').locator('[data-name-cell]').click()
  await win.keyboard.press('Control+ArrowDown')
  await win.keyboard.press('Control+ArrowDown')
  assert.equal(await focusedName(), 'f12.txt')
  assert.deepEqual(await selectedNames(), ['f10.txt'])
  await win.keyboard.press('Control+Space')
  assert.deepEqual(await selectedNames(), ['f10.txt', 'f12.txt'])
})

test('F5 mantém a seleção', async () => {
  await win.keyboard.press('F5')
  await win.waitForTimeout(500)
  assert.deepEqual(await selectedNames(), ['f10.txt', 'f12.txt'])
})
