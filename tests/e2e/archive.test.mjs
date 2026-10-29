// Compactar e extrair (.zip e .tar.gz), conflitos, falta do "zip" e bloqueio de zip slip.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { callApi, dialogBox, dockerSh, fileList, launchApp, saveConnection, screenshot, state, tempDir } from './helpers.mjs'

const S = state()
const A = S.a
const sh = (cmd, user) => dockerSh(A.name, cmd, user)
const DIR = '/config/arq'
let app, win, errors, vpsId

const row = (name) => fileList(win).locator(`[data-path="${DIR}/${name}"]`)
const menu = async (name, item) => {
  await row(name).click({ button: 'right' })
  await win.getByRole('menuitem', { name: item }).click()
}
const compressDialog = () => dialogBox(win, 'Compactar')

/** .tar mínimo (ustar) com uma única entrada, para montar arquivos maliciosos. */
function tarWith(name, content) {
  const header = Buffer.alloc(512)
  const put = (value, offset, len) => header.write(value, offset, len, 'ascii')
  put(name, 0, 100)
  put('0000644\0', 100, 8)
  put('0000000\0', 108, 8)
  put('0000000\0', 116, 8)
  put(Buffer.byteLength(content).toString(8).padStart(11, '0') + '\0', 124, 12)
  put('00000000000\0', 136, 12)
  put('        ', 148, 8)
  put('0', 156, 1)
  put('ustar\0', 257, 6)
  put('00', 263, 2)
  const sum = header.reduce((a, b) => a + b, 0)
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  const body = Buffer.alloc(Math.ceil(Buffer.byteLength(content) / 512) * 512)
  body.write(content)
  return Buffer.concat([header, body, Buffer.alloc(1024)])
}

before(async () => {
  sh('rm -rf /config/arq /config/.vpshub-trash /config/evil.txt && mkdir -p /config/arq/site/css && cd /config/arq && echo i > site/index.html && echo c > site/css/s.css && echo a > a.txt && echo b > b.txt')
  const first = await launchApp()
  vpsId = await saveConnection(first.win, { name: 'Arq', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, DIR).waitFor({ timeout: 30_000 })
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('compacta uma pasta em .tar.gz pelo diálogo', async () => {
  await menu('site', 'Compactar…')
  await compressDialog().getByRole('radio', { name: '.tar.gz' }).click()
  assert.equal(await compressDialog().getByRole('textbox').inputValue(), 'site.tar.gz', 'nome acompanha o formato')
  await screenshot(win, 'compactar')
  await compressDialog().getByRole('button', { name: 'Compactar' }).click()
  await row('site.tar.gz').waitFor()
  assert.match(sh(`tar -tzf ${DIR}/site.tar.gz`), /site\/css\/s\.css/)
})

const openZipDialogForTwoFiles = async () => {
  await row('a.txt').click()
  await row('b.txt').click({ modifiers: ['Control'] })
  await row('b.txt').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Compactar…' }).click()
  assert.equal(await compressDialog().getByRole('textbox').inputValue(), 'arq.zip', 'vários itens usam o nome da pasta')
  await compressDialog().getByRole('button', { name: 'Compactar' }).click()
  await compressDialog().getByText(/"zip" não está instalado na VPS/).waitFor()
  return compressDialog().getByRole('region', { name: 'Instalar zip' })
}

test('sem o "zip" e sem privilégio, o diálogo mostra o comando e não oferece instalar', async () => {
  const box = await openZipDialogForTwoFiles()
  await box.getByText('sudo apk add --no-cache zip').waitFor()
  await box.getByText(/exige root ou sudo sem senha/).waitFor()
  assert.equal(await box.getByRole('button', { name: 'Instalar agora' }).count(), 0)
  await compressDialog().getByRole('button', { name: 'Cancelar' }).click()
})

test('com sudo sem senha, "Instalar agora" instala o zip e compacta em seguida', async () => {
  sh('echo "dev ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/vpshub-e2e && chmod 440 /etc/sudoers.d/vpshub-e2e', '0')
  try {
    const box = await openZipDialogForTwoFiles()
    await box.getByText('sudo apk add --no-cache zip').waitFor()
    await screenshot(win, 'instalar-zip')
    await box.getByRole('button', { name: 'Instalar agora' }).click()
    await win.getByText('"zip" instalado na VPS.').waitFor({ timeout: 60_000 })
    await row('arq.zip').waitFor()
    assert.equal(sh(`unzip -l ${DIR}/arq.zip | grep -c "[ab].txt"`), '2')
  } finally {
    sh('rm -f /etc/sudoers.d/vpshub-e2e', '0')
  }
})

test('extrai para uma pasta nova sem tocar no que existe (BusyBox unzip)', async () => {
  await menu('arq.zip', 'Extrair para "arq/"')
  await row('arq').waitFor()
  assert.equal(sh(`cat ${DIR}/arq/a.txt`), 'a')
  await menu('site.tar.gz', 'Extrair para "site/"')
  await row('site (2)').waitFor()
  assert.equal(sh(`cat "${DIR}/site (2)/site/index.html"`), 'i')
  assert.equal(sh(`cat ${DIR}/site/index.html`), 'i', 'pasta original intacta')
})

test('"Extrair aqui" com conflito pede confirmação e manda o atual para a lixeira', async () => {
  sh(`echo modificado > ${DIR}/site/index.html`)
  await menu('site.tar.gz', 'Extrair aqui')
  const confirm = dialogBox(win, 'Substituir itens existentes?')
  await confirm.getByText(/Já existem nesta pasta: site/).waitFor()
  await confirm.getByRole('button', { name: 'Substituir' }).click()
  await win.getByText('site.tar.gz extraído.').waitFor()
  assert.equal(sh(`cat ${DIR}/site/index.html`), 'i', 'conteúdo do arquivo')
  assert.equal(sh('cat /config/.vpshub-trash/*/site/index.html'), 'modificado', 'versão anterior na lixeira')
})

test('Info-ZIP unzip e .tgz; conflito é detectado antes de extrair', async () => {
  sh('apk add --no-cache unzip >/dev/null', '0')
  sh(`cd ${DIR} && cp site.tar.gz pacote.tgz && cp arq.zip copia.zip`)
  const folder = await callApi(win, 'fs.extract', vpsId, `${DIR}/pacote.tgz`, 'folder', false)
  assert.deepEqual(folder.data, [`${DIR}/pacote`], 'nome da pasta sem ".tgz"')
  const here = await callApi(win, 'fs.extract', vpsId, `${DIR}/copia.zip`, 'here', false)
  assert.equal(here.code, 'EXISTS', 'Info-ZIP lista as entradas e detecta conflito')
  assert.match(here.error, /a\.txt, b\.txt/)
})

test('arquivo com entrada "../" nunca escreve fora da pasta (zip slip)', async () => {
  const local = join(tempDir('vpshub-evil-'), 'evil.tar')
  writeFileSync(local, tarWith('../evil.txt', 'pwned'))
  execFileSync('docker', ['cp', local, `${A.name}:${DIR}/evil.tar`])
  sh(`chown dev ${DIR}/evil.tar`, '0')
  const outside = () => sh('test -e /config/evil.txt && echo sim || echo nao')

  // BusyBox tar remove o "../" ao listar e ao extrair: o arquivo cai dentro da pasta nova.
  const busybox = await callApi(win, 'fs.extract', vpsId, `${DIR}/evil.tar`, 'folder', false)
  assert.deepEqual(busybox.data, [`${DIR}/evil`])
  assert.equal(sh(`cat ${DIR}/evil/evil.txt`), 'pwned')
  assert.equal(outside(), 'nao')

  // GNU tar (Ubuntu/Debian) lista "../evil.txt": o app recusa antes de extrair.
  sh('apk add --no-cache tar >/dev/null', '0')
  for (const mode of ['folder', 'here']) {
    const r = await callApi(win, 'fs.extract', vpsId, `${DIR}/evil.tar`, mode, true)
    assert.match(r.error, /recusado por segurança.*\.\.\/evil\.txt/)
  }
  assert.equal(outside(), 'nao')
  assert.equal(sh(`test -e "${DIR}/evil (2)" && echo sim || echo nao`), 'nao', 'recusa não cria pasta')
})
