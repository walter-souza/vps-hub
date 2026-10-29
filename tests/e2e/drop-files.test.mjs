// Arrastar arquivos do Windows para uma pasta específica (linha, caminho ou área da lista).
// O arraste é injetado pelo protocolo do Chromium com caminhos reais, como faria o Explorer do Windows.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { dialogBox, dockerSh, eventually, fileList, launchApp, saveConnection, state, tempDir } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/drop'
const sh = (cmd) => dockerSh(A.name, cmd)
let app, win, errors, cdp, local

const row = (name) => fileList(win).locator(`[data-path="${DIR}/${name}"]`)
const center = async (locator) => {
  const b = await locator.boundingBox()
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
}
const drag = (type, { x, y }, files) =>
  cdp.send('Input.dispatchDragEvent', { type, x, y, data: { items: [], files, dragOperationsMask: 1 } })

/** Arrasta arquivos locais até o alvo; pausa opcional sobre ele antes de soltar. */
async function dropFiles(files, target, { pauseMs = 0, then } = {}) {
  let point = await center(target)
  await drag('dragEnter', point, files)
  await drag('dragOver', point, files)
  if (pauseMs) {
    await win.waitForTimeout(pauseMs)
    await drag('dragOver', point, files)
  }
  if (then) point = await center(await then())
  await drag('dragOver', point, files)
  await drag('drop', point, files)
}

before(async () => {
  sh(`rm -rf ${DIR} && mkdir -p ${DIR}/site/assets`)
  local = tempDir('vpshub-local-')
  writeFileSync(join(local, 'index.html'), '<h1>oi</h1>')
  mkdirSync(join(local, 'img'))
  writeFileSync(join(local, 'img', 'logo.svg'), '<svg/>')
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Drop', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  cdp = await win.context().newCDPSession(win)
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, DIR).waitFor({ timeout: 30_000 })
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('soltar sobre uma pasta envia para dentro dela, mostrando o destino', async () => {
  const target = await center(row('site'))
  const file = join(local, 'index.html')
  await drag('dragEnter', target, [file])
  await drag('dragOver', target, [file])
  await win.getByRole('status').filter({ hasText: '→ Enviar para site' }).waitFor()
  await drag('drop', target, [file])
  await win.getByText(`Envio para ${DIR}/site concluído.`).waitFor()
  assert.equal(sh(`cat ${DIR}/site/index.html`), '<h1>oi</h1>')
  assert.equal(await row('index.html').count(), 0, 'não foi para a pasta aberta')
})

test('soltar uma pasta do Windows no espaço vazio envia para a pasta atual', async () => {
  const list = fileList(win)
  const box = await list.boundingBox()
  await drag('dragEnter', { x: box.x + 200, y: box.y + box.height - 40 }, [join(local, 'img')])
  await drag('dragOver', { x: box.x + 200, y: box.y + box.height - 40 }, [join(local, 'img')])
  await drag('drop', { x: box.x + 200, y: box.y + box.height - 40 }, [join(local, 'img')])
  await row('img').waitFor()
  assert.equal(sh(`cat ${DIR}/img/logo.svg`), '<svg/>')
})

test('parar sobre uma pasta abre a pasta e o arquivo cai lá dentro', async () => {
  await dropFiles([join(local, 'index.html')], row('site'), {
    pauseMs: 1300,
    then: async () => {
      await fileList(win, `${DIR}/site`).waitFor()
      return fileList(win).locator(`[data-path="${DIR}/site/assets"]`)
    }
  })
  await eventually(() => assert.equal(sh(`cat ${DIR}/site/assets/index.html`), '<h1>oi</h1>'))
})

test('soltar num trecho do caminho envia para aquela pasta, confirmando substituição', async () => {
  await fileList(win, `${DIR}/site`).waitFor()
  await dropFiles([join(local, 'img')], win.getByRole('button', { name: 'drop', exact: true }))
  const confirm = dialogBox(win, 'Substituir itens existentes?')
  await confirm.getByText(`já existem em ${DIR}`).waitFor()
  await confirm.getByRole('button', { name: 'Substituir' }).click()
  await win.getByText(`Envio para ${DIR} concluído.`).waitFor()
})

test('arquivos do Windows não podem ser soltos na Lixeira', async () => {
  const trash = await center(win.getByRole('button', { name: 'Lixeira' }))
  const file = join(local, 'index.html')
  const before = sh(`find ${DIR} /config/.vpshub-trash 2>/dev/null | wc -l`)
  await drag('dragEnter', trash, [file])
  await drag('dragOver', trash, [file])
  assert.equal(await win.getByRole('status').filter({ hasText: '→' }).count(), 0, 'sem balão de destino')
  await drag('drop', trash, [file])
  await win.waitForTimeout(800)
  assert.equal(sh(`find ${DIR} /config/.vpshub-trash 2>/dev/null | wc -l`), before, 'nada foi enviado nem excluído')
})
