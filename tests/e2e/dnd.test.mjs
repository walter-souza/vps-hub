// Arrastar e soltar itens dentro do explorador: mover, copiar (Ctrl), Lixeira, caminho, abrir pasta ao parar.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { dialogBox, dockerSh, eventually, fileList, launchApp, saveConnection, screenshot, state } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/dnd'
const sh = (cmd) => dockerSh(A.name, cmd)
const exists = (path) => sh(`test -e "${path}" && echo sim || echo nao`) === 'sim'
let app, win, errors

const row = (name) => fileList(win).locator(`[data-path="${DIR}/${name}"]`)
const nameCell = (name) => row(name).locator('[data-name-cell]')
const inside = (dir) => fileList(win, dir).waitFor({ timeout: 10_000 })

/** Arrasta com o mouse (passo a passo), para poder parar sobre alvos e ler o balão. */
async function dragWithMouse(source, steps) {
  const from = await source.boundingBox()
  await win.mouse.move(from.x + 10, from.y + from.height / 2)
  await win.mouse.down()
  for (const step of steps) await step()
  await win.mouse.up()
}
const hoverOver = (locator, waitMs = 0) => async () => {
  const box = await locator.boundingBox()
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
  if (waitMs) await win.waitForTimeout(waitMs)
}

before(async () => {
  sh(`rm -rf ${DIR} /config/.vpshub-trash && mkdir -p ${DIR}/a ${DIR}/b/sub && cd ${DIR} && echo x > x.txt && echo y > y.txt && echo z > z.txt`)
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Dnd', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar' }).click()
  await inside(DIR)
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('arrastar um arquivo para uma pasta move sem perguntar; "Desfazer" volta', async () => {
  await nameCell('x.txt').dragTo(row('a'))
  const toast = win.getByRole('status').filter({ hasText: '1 item(ns) movido(s) para a.' })
  await toast.waitFor()
  assert.ok(exists(`${DIR}/a/x.txt`) && !exists(`${DIR}/x.txt`))
  await toast.getByRole('button', { name: 'Desfazer' }).click()
  await row('x.txt').waitFor()
  assert.ok(exists(`${DIR}/x.txt`) && !exists(`${DIR}/a/x.txt`))
})

test('vários itens selecionados vão juntos e o balão mostra o destino', async () => {
  await nameCell('y.txt').click()
  await nameCell('z.txt').click({ modifiers: ['Control'] })
  await dragWithMouse(nameCell('z.txt'), [
    hoverOver(row('a')),
    async () => {
      await win.getByRole('status').filter({ hasText: '→ Mover para a' }).waitFor()
      assert.equal(await row('a').evaluate((el) => el.className.includes('ring-accent')), true, 'pasta destacada')
      assert.equal(await row('y.txt').evaluate((el) => el.className.includes('opacity-50')), true, 'itens arrastados esmaecidos')
      await screenshot(win, 'arrastar-balao')
    }
  ])
  await win.getByText('2 item(ns) movido(s) para a.').waitFor()
  assert.ok(exists(`${DIR}/a/y.txt`) && exists(`${DIR}/a/z.txt`))
})

test('Ctrl + arrastar copia em vez de mover', async () => {
  await win.keyboard.down('Control')
  await nameCell('x.txt').dragTo(row('b'))
  await win.keyboard.up('Control')
  await win.getByText('1 item(ns) copiado(s) para b.').waitFor()
  assert.ok(exists(`${DIR}/b/x.txt`) && exists(`${DIR}/x.txt`))
})

test('soltar uma pasta nela mesma não faz nada', async () => {
  await nameCell('b').dragTo(row('b'))
  await win.waitForTimeout(500)
  assert.ok(exists(`${DIR}/b/sub`) && !exists(`${DIR}/b/b`))
})

test('soltar num trecho do caminho move para aquela pasta', async () => {
  await row('a').dblclick()
  await inside(`${DIR}/a`)
  const crumb = win.getByRole('button', { name: 'dnd', exact: true })
  await fileList(win).locator(`[data-path="${DIR}/a/y.txt"] [data-name-cell]`).dragTo(crumb)
  await win.getByText('1 item(ns) movido(s) para dnd.').waitFor()
  assert.ok(exists(`${DIR}/y.txt`) && !exists(`${DIR}/a/y.txt`))
  await win.getByRole('button', { name: 'Pasta acima (Alt+↑)' }).click()
  await inside(DIR)
})

test('arrastar para a Lixeira manda sem perguntar e oferece "Desfazer"', async () => {
  await nameCell('y.txt').dragTo(win.getByRole('button', { name: 'Lixeira' }))
  const toast = win.getByRole('status').filter({ hasText: '"y.txt" movido(s) para a lixeira.' })
  await toast.waitFor()
  assert.equal(await dialogBox(win, /lixeira\?/).count(), 0, 'sem diálogo de confirmação')
  assert.ok(!exists(`${DIR}/y.txt`))
  await toast.getByRole('button', { name: 'Desfazer' }).click()
  await row('y.txt').waitFor()
})

test('parar sobre uma pasta durante o arraste abre a pasta', async () => {
  await dragWithMouse(nameCell('y.txt'), [
    hoverOver(row('b'), 1300),
    async () => inside(`${DIR}/b`),
    hoverOver(fileList(win).locator(`[data-path="${DIR}/b/sub"]`))
  ])
  await win.getByText('1 item(ns) movido(s) para sub.').waitFor()
  assert.ok(exists(`${DIR}/b/sub/y.txt`))
})

test('nome repetido no destino pede confirmação e a versão anterior vai para a lixeira', async () => {
  await win.getByRole('button', { name: 'Pasta acima (Alt+↑)' }).click()
  await inside(DIR)
  sh(`echo antigo > ${DIR}/a/x.txt`)
  await nameCell('x.txt').dragTo(row('a'))
  await dialogBox(win, 'Substituir itens existentes?').getByRole('button', { name: 'Substituir' }).click()
  await eventually(() => assert.equal(sh(`cat ${DIR}/a/x.txt`), 'x'))
  assert.equal(sh('cat /config/.vpshub-trash/*/x.txt'), 'antigo')
})

// ---------- Sair de uma pasta aberta por engano durante o arraste ----------
const sub = () => fileList(win).locator(`[data-path="${DIR}/b/sub"]`)
const hint = (text) => win.getByRole('status').filter({ hasText: text })
const backButton = () => win.getByRole('button', { name: 'Voltar (Alt+←)' })
/** Solta fora de qualquer alvo (cabeçalho do Acesso rápido) e mexe o mouse, como depois de um Esc. */
const releaseOutside = async () => {
  await hoverOver(win.getByText('Acesso rápido', { exact: true }))()
}

test('entrou numa pasta por engano: parar sobre "Voltar" sai dela e o balão mostra a origem', async () => {
  sh(`cd ${DIR} && echo m > m.txt && echo n > n.txt && echo o > o.txt && echo p > p.txt`)
  await win.getByRole('button', { name: 'Atualizar (F5)' }).click()
  await row('m.txt').waitFor()
  await dragWithMouse(nameCell('m.txt'), [
    hoverOver(row('b'), 1300),
    async () => inside(`${DIR}/b`),
    hoverOver(sub()),
    async () => {
      await hint('de /config/dnd · Esc cancela e volta').waitFor()
      await screenshot(win, 'arrastar-origem')
    },
    hoverOver(backButton()),
    async () => hint('← Voltar para dnd').waitFor(),
    hoverOver(backButton(), 1300),
    async () => inside(DIR),
    hoverOver(row('a'))
  ])
  await win.getByText('1 item(ns) movido(s) para a.').waitFor()
  assert.ok(exists(`${DIR}/a/m.txt`))
})

test('cancelar o arraste depois de entrar em pastas volta à origem com o item selecionado', async () => {
  await dragWithMouse(nameCell('n.txt'), [hoverOver(row('b'), 1300), async () => inside(`${DIR}/b`), hoverOver(sub(), 1300), async () => inside(`${DIR}/b/sub`), releaseOutside])
  await win.mouse.move(400, 400)
  await inside(DIR)
  await win.getByRole('option', { name: 'n.txt', selected: true }).waitFor()
  assert.ok(exists(`${DIR}/n.txt`) && !exists(`${DIR}/b/sub/n.txt`), 'nada foi movido')
})

test('parar sobre "Pasta acima" sobe um nível durante o arraste', async () => {
  await dragWithMouse(nameCell('o.txt'), [
    hoverOver(row('b'), 1300),
    async () => inside(`${DIR}/b`),
    hoverOver(sub(), 1300),
    async () => inside(`${DIR}/b/sub`),
    hoverOver(win.getByRole('button', { name: 'Pasta acima (Alt+↑)' })),
    async () => hint('↑ Subir para b').waitFor(),
    hoverOver(win.getByRole('button', { name: 'Pasta acima (Alt+↑)' }), 1300),
    async () => inside(`${DIR}/b`),
    hoverOver(sub())
  ])
  await win.getByText('1 item(ns) movido(s) para sub.').waitFor()
  assert.ok(exists(`${DIR}/b/sub/o.txt`))
  await win.getByRole('button', { name: 'Pasta acima (Alt+↑)' }).click()
  await inside(DIR)
})

test('parar sobre o trecho do caminho da pasta de origem volta para ela', async () => {
  await dragWithMouse(nameCell('p.txt'), [
    hoverOver(row('b'), 1300),
    async () => inside(`${DIR}/b`),
    hoverOver(win.getByRole('button', { name: 'dnd', exact: true })),
    async () => hint('Abrir dnd').waitFor(),
    hoverOver(win.getByRole('button', { name: 'dnd', exact: true }), 1300),
    async () => inside(DIR),
    releaseOutside
  ])
  await win.mouse.move(400, 400)
  await win.waitForTimeout(300)
  await inside(DIR)
  assert.ok(exists(`${DIR}/p.txt`))
})

test('soltar num atalho do Acesso rápido move para lá', async () => {
  await nameCell('p.txt').dragTo(win.getByRole('button', { name: '/tmp' }))
  const toast = win.getByRole('status').filter({ hasText: '1 item(ns) movido(s) para tmp.' })
  await toast.waitFor()
  assert.ok(exists('/tmp/p.txt'))
  await toast.getByRole('button', { name: 'Desfazer' }).click()
  await row('p.txt').waitFor()
})
