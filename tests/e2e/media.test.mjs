// Áudio e vídeo: abrir no reprodutor e servir em streaming (Range) pelo esquema vpshub-media://.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { callApi, dockerSh, fileList, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
const DIR = '/config/media'
const sh = (cmd) => dockerSh(A.name, cmd)
let app, win, errors, vpsId

/** WAV de 1 s (8 kHz, 8 bits, mono): 44 bytes de cabeçalho + 8000 de amostras. */
function wav() {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + 8000, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(8000, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write('data', 36)
  header.writeUInt32LE(8000, 40)
  return Buffer.concat([header, Buffer.alloc(8000, 128)])
}
const SIZE = 8044
const url = (path, id = vpsId) => `vpshub-media://${id}${encodeURI(path)}`
/** Pede ao esquema pelo processo principal (o fetch da página é limitado pela CSP). */
const fetchMedia = (target, headers = {}) =>
  app.evaluate(async ({ net }, [target, headers]) => {
    const r = await net.fetch(target, { headers })
    return { status: r.status, type: r.headers.get('content-type'), range: r.headers.get('content-range'), length: (await r.arrayBuffer()).byteLength }
  }, [target, headers])

before(async () => {
  sh(`rm -rf ${DIR} && mkdir -p ${DIR} && echo '${wav().toString('base64')}' | base64 -d > ${DIR}/tom.wav && echo texto > ${DIR}/nota.txt`)
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Media', port: A.port, initialPath: DIR, secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar' }).click()
  await fileList(win, DIR).waitFor({ timeout: 30_000 })
  vpsId = (await callApi(win, 'connections.list')).data.find((c) => c.name === 'Media').id
})
after(async () => {
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('duplo clique num áudio abre o reprodutor e o arquivo carrega em streaming', async () => {
  await fileList(win).locator(`[data-path="${DIR}/tom.wav"] [data-name-cell]`).dblclick()
  await win.getByRole('tab', { name: /tom\.wav/ }).waitFor()
  const audio = win.locator('audio[aria-label="tom.wav"]')
  await audio.waitFor()
  await win.waitForFunction(() => document.querySelector('audio')?.readyState >= 1)
  assert.ok(Math.abs(await audio.evaluate((el) => el.duration) - 1) < 0.05, 'duração de 1 s')
  assert.equal(await win.locator('.monaco-editor').count(), 0, 'não abriu o editor')
})

test('o esquema responde a Range com 206 e Content-Range corretos', async () => {
  assert.deepEqual(await fetchMedia(url(`${DIR}/tom.wav`)), { status: 200, type: 'audio/wav', range: null, length: SIZE })
  assert.deepEqual(await fetchMedia(url(`${DIR}/tom.wav`), { Range: 'bytes=0-9' }), {
    status: 206, type: 'audio/wav', range: `bytes 0-9/${SIZE}`, length: 10
  })
  assert.deepEqual(await fetchMedia(url(`${DIR}/tom.wav`), { Range: 'bytes=8000-' }), {
    status: 206, type: 'audio/wav', range: `bytes 8000-${SIZE - 1}/${SIZE}`, length: SIZE - 8000
  })
  assert.deepEqual(await fetchMedia(url(`${DIR}/tom.wav`), { Range: 'bytes=-44' }), {
    status: 206, type: 'audio/wav', range: `bytes ${SIZE - 44}-${SIZE - 1}/${SIZE}`, length: 44
  })
  assert.equal((await fetchMedia(url(`${DIR}/tom.wav`), { Range: `bytes=${SIZE + 5}-` })).status, 416)
})

test('o esquema só serve mídia conhecida de VPS conectadas', async () => {
  assert.equal((await fetchMedia(url(`${DIR}/nota.txt`))).status, 403, 'extensão fora da lista')
  assert.equal((await fetchMedia(url('/etc/passwd'))).status, 403)
  assert.equal((await fetchMedia(url(`${DIR}/tom.wav`, 'id-que-nao-existe'))).status, 404, 'VPS desconhecida')
  assert.equal((await fetchMedia(url(`${DIR}/inexistente.wav`))).status, 500, 'arquivo inexistente não vaza dados')
  assert.equal((await fetchMedia(url(`${DIR}/../media/tom.wav`))).status, 200, 'caminho é normalizado')
})
