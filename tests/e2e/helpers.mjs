// Utilitários compartilhados pelas suítes E2E (app Electron real + servidores SSH em Docker).
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../..')
export const OUTPUT = join(ROOT, 'tests/e2e/.output')
export const STATE_FILE = join(tmpdir(), 'vpshub-e2e-state.json')
const electronPath = createRequire(import.meta.url)('electron')

/** Dados gravados pelo setup global: containers, portas, chave de teste e senhas. */
export const state = () => JSON.parse(readFileSync(STATE_FILE, 'utf8'))

/** Executa um comando no container (sem passar pelo shell local, então só há um nível de aspas). */
export function dockerSh(container, cmd, user = '1000') {
  return execFileSync('docker', ['exec', '-u', user, container, 'sh', '-c', cmd], { encoding: 'utf8' }).trim()
}

export const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix))

/** Espera o sshd responder com o banner "SSH-". */
export async function waitForSsh(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await new Promise((done) => {
      const sock = connect({ host: '127.0.0.1', port })
      sock.setTimeout(2000, () => (sock.destroy(), done(false)))
      sock.once('data', (d) => (sock.destroy(), done(d.toString().startsWith('SSH-'))))
      sock.once('error', () => done(false))
      // Enquanto o container sobe, o proxy do Docker aceita e fecha a conexão sem enviar nada.
      sock.once('close', () => done(false))
    })
    if (ok) return new Promise((r) => setTimeout(r, 1500)) // usuários do container terminam de ser criados
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`sshd na porta ${port} não respondeu`)
}

/**
 * Abre o app com um perfil isolado. Os diálogos nativos são substituídos: a host key é aceita
 * (as mensagens ficam em globalThis.__boxes) e "escolher pasta" devolve downloadDir.
 */
export async function launchApp({ userData = tempDir('vpshub-ud-'), env = {}, downloadDir = tempDir('vpshub-dl-') } = {}) {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [ROOT, `--user-data-dir=${userData}`],
    env: { ...process.env, ...env }
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  await app.evaluate(({ dialog }, dir) => {
    globalThis.__boxes = []
    dialog.showMessageBox = async (w, o) => {
      globalThis.__boxes.push((o ?? w).message)
      return { response: 0 }
    }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, downloadDir)
  return { app, win, errors, userData, downloadDir }
}

export const dialogBox = (win, name) => win.getByRole('dialog', { name })

/** Preenche um diálogo de texto (prompt) e confirma. */
export async function answerPrompt(win, title, value, button) {
  const d = dialogBox(win, title)
  await d.locator('input').fill(value)
  await d.getByRole('button', { name: button }).click()
  await d.waitFor({ state: 'detached' })
}

/** Cadastra uma conexão por senha direto pela API e retorna o id. */
export function saveConnection(win, fields) {
  return win.evaluate(
    (f) =>
      window.vpsApi.connections
        .save({ host: '127.0.0.1', username: 'dev', auth: 'password', keyPath: '', initialPath: '', color: '#3b82f6', tags: [], rememberSecret: true, ...f })
        .then((c) => c.id),
    fields
  )
}

/** Chama window.vpsApi no renderer; rejeições voltam como { error } (o contextBridge entrega objetos simples). */
export function callApi(win, path, ...args) {
  return win.evaluate(
    ([path, args]) => {
      const fn = path.split('.').reduce((o, k) => o[k], window.vpsApi)
      return fn(...args).then(
        (data) => ({ data }),
        (e) => ({ error: e.message, code: e.code })
      )
    },
    [path, args]
  )
}

/** Repete a verificação até passar (para efeitos assíncronos no servidor, sem esperas fixas). */
export async function eventually(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await check()
    } catch (e) {
      if (Date.now() > deadline) throw e
      await new Promise((r) => setTimeout(r, 200))
    }
  }
}

export function screenshot(win, name) {
  mkdirSync(OUTPUT, { recursive: true })
  return win.screenshot({ path: join(OUTPUT, `${name}.png`) })
}

/** Lista de arquivos visível (há uma por workspace; as ocultas ficam montadas). */
export const fileList = (win, dir) =>
  win.getByRole('listbox', dir ? { name: `Arquivos em ${dir}`, exact: true } : { name: /^Arquivos em / }).locator('visible=true')
