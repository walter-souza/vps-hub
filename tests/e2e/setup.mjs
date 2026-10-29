// Setup global do node --test: sobe dois servidores SSH descartáveis e gera uma chave de teste.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_FILE, tempDir, waitForSsh } from './helpers.mjs'

const IMAGE = 'lscr.io/linuxserver/openssh-server:latest'
const PASSWORD = 'senha123'
const PASSPHRASE = 'frase123'
const SERVERS = { a: { name: 'vpshub-e2e-a', port: 22220 }, b: { name: 'vpshub-e2e-b', port: 22221 } }

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const removeContainers = () => Object.values(SERVERS).forEach((s) => execFileSync('docker', ['rm', '-f', s.name], { stdio: 'ignore' }))

export async function globalSetup() {
  try {
    docker('info', '--format', '{{.ServerVersion}}')
  } catch {
    throw new Error('Docker não está rodando. Inicie o Docker Desktop para rodar os testes E2E.')
  }
  const dir = tempDir('vpshub-e2e-')
  const keyPath = join(dir, 'testkey')
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', PASSPHRASE, '-f', keyPath, '-C', 'vpshub-e2e', '-q'])
  const publicKey = readFileSync(`${keyPath}.pub`, 'utf8').trim()

  removeContainers()
  for (const s of Object.values(SERVERS)) {
    docker(
      'run', '-d', '--name', s.name, '-p', `${s.port}:2222`,
      '-e', 'PUID=1000', '-e', 'PGID=1000', '-e', 'USER_NAME=dev',
      '-e', 'PASSWORD_ACCESS=true', '-e', `USER_PASSWORD=${PASSWORD}`, '-e', `PUBLIC_KEY=${publicKey}`,
      IMAGE
    )
  }
  await Promise.all(Object.values(SERVERS).map((s) => waitForSsh(s.port)))
  writeFileSync(STATE_FILE, JSON.stringify({ dir, keyPath, password: PASSWORD, passphrase: PASSPHRASE, ...SERVERS }))
}

export async function globalTeardown() {
  if (process.env.VPSHUB_E2E_KEEP) return // mantém os containers para depurar
  removeContainers()
  try {
    rmSync(JSON.parse(readFileSync(STATE_FILE, 'utf8')).dir, { recursive: true, force: true })
    rmSync(STATE_FILE, { force: true })
  } catch {
    // setup falhou antes de gravar o estado
  }
}
