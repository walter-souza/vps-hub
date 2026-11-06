// Serviços do systemd e contêineres do Docker, contra `systemctl` e `docker` de mentira instalados no servidor
// (os contêineres de teste não têm systemd nem Docker). Os scripts guardam estado em arquivos e registram as chamadas.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { callApi, dialogBox, dockerSh, eventually, fileList, launchApp, saveConnection, state } from './helpers.mjs'

const S = state()
const A = S.a
const root = (cmd) => dockerSh(A.name, cmd, '0')
const sh = (cmd) => dockerSh(A.name, cmd)
const STATE = '/var/tmp/fakectl'
let app, win, errors, vpsId

const SYSTEMCTL = `#!/bin/sh
S=${STATE}
verb="$1"
for last; do :; done
if [ -f $S/deny ]; then
  case "$verb" in start|stop|restart|reload|enable|disable) echo "Failed to $verb $last: Interactive authentication required." >&2; exit 1;; esac
fi
case "$verb" in
  list-units)
    for f in $S/units/*; do
      n=$(basename "$f"); read act sub desc < "$f"
      echo "$n loaded $act $sub $desc"
    done ;;
  list-unit-files)
    for f in $S/units/*; do n=$(basename "$f"); echo "$n $(cat $S/enabled/$n 2>/dev/null || echo disabled)"; done
    echo "masked.service masked" ;;
  start|restart) echo "active running $(cut -d' ' -f3- $S/units/$last)" > $S/units/$last; echo "$verb $last" >> $S/calls ;;
  stop) echo "inactive dead $(cut -d' ' -f3- $S/units/$last)" > $S/units/$last; echo "$verb $last" >> $S/calls ;;
  enable|disable) echo "$verb" | sed 's/enable/enabled/;s/disable/disabled/' > $S/enabled/$last; echo "$verb $last" >> $S/calls ;;
  status) read act sub desc < $S/units/$last; printf '● %s - %s\\n     Active: %s (%s)\\nNov 06 10:00:00 host app[1]: linha de log do serviço\\n' "$last" "$desc" "$act" "$sub"; exit 3 ;;
  *) exit 0 ;;
esac
`

const DOCKER = `#!/bin/sh
S=${STATE}
verb="$1"
for last; do :; done
case "$verb" in
  ps)
    for f in $S/containers/*; do
      [ -e "$f" ] || continue
      n=$(basename "$f"); IFS='|' read id st status image ports < "$f"
      printf '{"ID":"%s","Names":"%s","Image":"%s","State":"%s","Status":"%s","Ports":"%s","CreatedAt":"2026-11-06 10:00:00 +0000 UTC"}\\n' "$id" "$n" "$image" "$st" "$status" "$ports"
    done ;;
  start|restart) IFS='|' read id st status image ports < $S/containers/$last; echo "$id|running|Up 1 second|$image|$ports" > $S/containers/$last; echo "$verb $last" >> $S/calls ;;
  stop) IFS='|' read id st status image ports < $S/containers/$last; echo "$id|exited|Exited (0) 1 second ago|$image|" > $S/containers/$last; echo "$verb $last" >> $S/calls ;;
  rm) rm $S/containers/$last; echo "rm $last" >> $S/calls ;;
esac
`

const put = (path, script) => root(`echo '${Buffer.from(script).toString('base64')}' | base64 -d > ${path} && chmod 755 ${path}`)
const calls = () => sh(`cat ${STATE}/calls 2>/dev/null || true`)
const reset = () => {
  root(`rm -rf ${STATE} && mkdir -p ${STATE}/units ${STATE}/enabled ${STATE}/containers && chmod -R 777 ${STATE}`)
  root(
    [
      `echo 'active running A high performance web server' > ${STATE}/units/nginx.service`,
      `echo 'active running Regular background program processing daemon' > ${STATE}/units/cron.service`,
      `echo 'failed failed Nightly backup' > ${STATE}/units/backup.service`,
      `echo 'inactive dead Old legacy service' > ${STATE}/units/old.service`,
      `echo enabled > ${STATE}/enabled/nginx.service; echo enabled > ${STATE}/enabled/cron.service`,
      `echo 'a1b2c3d4e5f6a7|running|Up 2 hours|nginx:latest|0.0.0.0:8080->80/tcp' > ${STATE}/containers/web`,
      `echo 'b2c3d4e5f6a7b8|exited|Exited (0) 3 days ago|postgres:16|' > ${STATE}/containers/db`,
      `chmod -R 777 ${STATE}`
    ].join('; ')
  )
}

const unitRow = (name) => win.locator(`[data-unit="${name}"]`)
const containerRow = (name) => win.locator(`[data-container="${name}"]`)
const section = (name) => win.getByRole('navigation', { name: 'Seções do painel' }).getByRole('button', { name })

before(async () => {
  put('/usr/local/bin/systemctl', SYSTEMCTL)
  put('/usr/local/bin/docker', DOCKER)
  reset()
  const first = await launchApp()
  await saveConnection(first.win, { name: 'Servicos', port: A.port, initialPath: '/config', secret: S.password })
  await first.app.close()
  ;({ app, win, errors } = await launchApp({ userData: first.userData }))
  await win.getByRole('button', { name: 'Conectar', exact: true }).click()
  await fileList(win, '/config').waitFor({ timeout: 30_000 })
  vpsId = (await callApi(win, 'connections.list')).data.find((c) => c.name === 'Servicos').id
  await win.getByRole('tab', { name: 'Painel' }).click()
})
after(async () => {
  root(`rm -rf ${STATE} /usr/local/bin/systemctl /usr/local/bin/docker`)
  await app?.close()
  assert.deepEqual(errors, [], 'erros no console do renderer')
})

test('o painel só mostra Serviços e Docker quando o servidor os tem', async () => {
  await section('Serviços').waitFor()
  await section('Docker').waitFor()
  assert.deepEqual((await callApi(win, 'services.availability', vpsId)).data, { systemd: true, docker: true })
})

test('lista os serviços com estado, boot e descrição, e filtra por texto e por estado', async () => {
  await section('Serviços').click()
  await unitRow('nginx.service').waitFor()
  assert.match(await unitRow('nginx.service').textContent(), /active \(running\).*enabled.*high performance/)
  assert.match(await unitRow('backup.service').textContent(), /failed \(failed\)/)
  assert.ok(await unitRow('masked.service').isVisible(), 'unidade que só existe como arquivo aparece como inativa')

  await win.getByLabel('Filtrar serviços').fill('cron')
  await unitRow('cron.service').waitFor()
  assert.equal(await unitRow('nginx.service').count(), 0)
  await win.getByLabel('Filtrar serviços').fill('')
  await win.getByLabel('Estado').selectOption('failed')
  await unitRow('nginx.service').waitFor({ state: 'detached' })
  assert.equal(await win.locator('[data-unit]').count(), 1)
  await win.getByLabel('Estado').selectOption('all')
})

test('parar pede confirmação; iniciar e reiniciar agem e a lista reflete o novo estado', async () => {
  await win.getByRole('button', { name: 'Parar nginx.service', exact: true }).click()
  await dialogBox(win, 'Parar nginx.service?').getByRole('button', { name: 'Parar', exact: true }).click()
  await win.getByText('nginx.service: parar concluído.').waitFor()
  await eventually(async () => assert.match(await unitRow('nginx.service').textContent(), /inactive \(dead\)/))
  await win.getByRole('button', { name: 'Iniciar nginx.service', exact: true }).click()
  await eventually(async () => assert.match(await unitRow('nginx.service').textContent(), /active \(running\)/))
  await win.getByRole('button', { name: 'Reiniciar cron.service', exact: true }).click()
  await eventually(() => assert.match(calls(), /restart cron\.service/))
  assert.match(calls(), /stop nginx\.service[\s\S]*start nginx\.service/)
})

test('detalhes mostram o status e permitem habilitar ou desabilitar no boot', async () => {
  await win.getByRole('button', { name: 'Detalhes de backup.service', exact: true }).click()
  const details = win.getByRole('region', { name: 'Detalhes de backup.service' })
  await details.getByText('linha de log do serviço').waitFor()
  await details.getByRole('button', { name: 'Habilitar no boot', exact: true }).click()
  await eventually(() => assert.match(calls(), /enable backup\.service/))
  await eventually(async () => assert.match(await unitRow('backup.service').textContent(), /enabled/))
  await details.getByRole('button', { name: 'Fechar', exact: true }).click()
})

test('falta de permissão vira uma mensagem com a dica do modo sudo', async () => {
  sh(`touch ${STATE}/deny`)
  await win.getByRole('button', { name: 'Iniciar old.service', exact: true }).click()
  const toast = win.getByRole('alert').filter({ hasText: 'Interactive authentication required' })
  await toast.waitFor()
  assert.match(await toast.textContent(), /ative o modo sudo/)
  sh(`rm -f ${STATE}/deny`)
})

test('Docker: lista contêineres, inicia, para e remove com confirmação', async () => {
  await section('Docker').click()
  await containerRow('web').waitFor()
  assert.match(await containerRow('web').textContent(), /nginx:latest.*Up 2 hours.*8080->80/)
  assert.match(await containerRow('db').textContent(), /postgres:16.*Exited/)

  await win.getByRole('button', { name: 'Iniciar db', exact: true }).click()
  await eventually(async () => assert.match(await containerRow('db').textContent(), /Up 1 second/))
  await win.getByRole('button', { name: 'Parar db', exact: true }).click()
  await dialogBox(win, 'Parar "db"?').getByRole('button', { name: 'Parar', exact: true }).click()
  await eventually(async () => assert.match(await containerRow('db').textContent(), /Exited/))

  await win.getByRole('button', { name: 'Remover db', exact: true }).click()
  await dialogBox(win, 'Remover "db"?').getByRole('button', { name: 'Remover', exact: true }).click()
  await containerRow('db').waitFor({ state: 'detached' })
  assert.match(calls(), /rm db/)
  assert.equal(await containerRow('web').count(), 1)
})

test('nomes inválidos são recusados antes de chegar ao servidor', async () => {
  const before = calls()
  assert.equal((await callApi(win, 'services.unitAction', vpsId, 'x.service; rm -rf /', 'start')).error, 'Nome de serviço inválido.')
  assert.equal((await callApi(win, 'services.unitAction', vpsId, 'nginx.service', 'mask')).error, 'Ação inválida.')
  assert.equal((await callApi(win, 'services.containerAction', vpsId, '$(reboot)', 'stop')).error, 'Nome de contêiner inválido.')
  assert.equal((await callApi(win, 'services.containerAction', vpsId, 'web', 'exec')).error, 'Ação inválida.')
  assert.equal(calls(), before)
})
