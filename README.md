# VPS Hub

App desktop (Electron) para gerenciar várias VPS e navegar pelos arquivos delas como no Explorer do Windows, via SSH/SFTP.

## Rodando

```bash
npm install
npm run dev        # desenvolvimento (F12 abre o DevTools)
npm run build      # build de produção em out/
npm run dist       # instalador Windows em dist/ ("VPS Hub Setup <versão>.exe")
npm run typecheck
npm run test:e2e   # testes de ponta a ponta (precisa do Docker Desktop rodando)
```

## Testes

`npm run test:e2e` gera o build, sobe dois servidores SSH descartáveis em Docker (portas 22220 e 22221), abre o app de verdade com Playwright e roda 42 cenários: conexão e host key, explorer, editor, transferências, terminal, queda de conexão, chave com passphrase, importação do `~/.ssh/config`, lixeira, copiar/colar (inclusive entre VPS) e busca (com BusyBox e com GNU grep). Os containers são removidos ao final; use `VPSHUB_E2E_KEEP=1` para mantê-los.

O instalador não é assinado digitalmente, então o Windows SmartScreen pode avisar na primeira execução ("Mais informações" → "Executar assim mesmo").

## Funcionalidades

- **Hub**: cadastrar, editar, duplicar e excluir conexões; testar a conexão antes de salvar; status online/latência; filtro por tags e busca.
- **Importar `~/.ssh/config`**: lista os hosts (respeitando `Host *`, `IdentityFile`, `Port`, `User`), marca os já cadastrados e avisa sobre ProxyJump, que ainda não é suportado.
- **Autenticação**: senha ou chave privada (OpenSSH ou .ppk, com passphrase). Senhas e passphrases podem ser lembradas, criptografadas pelo Windows (DPAPI via `safeStorage`); se não estiverem salvas, o app pede na hora de conectar.
- **Host key**: na primeira conexão o fingerprint é exibido para confirmação; se mudar depois, o app avisa (possível ataque man-in-the-middle).
- **Explorer**: navegação com histórico, breadcrumb editável (Ctrl+L, aceita `~`), acesso rápido, ordenação, filtro, arquivos ocultos, multisseleção, menu de contexto e atalhos (F2, Del, F5, Enter, Alt+←/→/↑, Ctrl+A, Ctrl+Shift+N).
- **Copiar, recortar e colar** (Ctrl+C/X/V ou menu): na mesma VPS usa `cp -a`/`mv` no servidor; entre VPS diferentes copia via SFTP preservando permissões e links. Colar na mesma pasta cria "nome - cópia"; itens substituídos vão para a lixeira.
- **Busca** (Ctrl+F, ou Enter no filtro): por nome ou por conteúdo, na pasta atual e subpastas, com opção de diferenciar maiúsculas e ignorar `node_modules`/`.git`. Resultados de conteúdo mostram a linha e abrem o editor nela. Até 500 resultados, cancelável; ignora `/proc`, `/sys`, `/dev`, binários e arquivos acima de 5 MB.
- **Editor** (Monaco): abas, Ctrl+S, detecção de conflito se o arquivo mudou no servidor, gravação atômica (arquivo temporário + rename), recusa binários, arquivos não UTF-8 e arquivos acima de 5 MB.
- **Transferências**: upload (botão ou arrastar do Windows, inclusive pastas) e download, com progresso.
- **Terminal** integrado (xterm.js), aberto na pasta atual.
- **Lixeira**: Del move para `~/.vpshub-trash` na própria VPS, com "Desfazer" na notificação; a Lixeira (no Acesso rápido) restaura para o local original, exclui itens ou esvazia tudo. Shift+Del apaga permanentemente.
- **Proteções**: confirmação para excluir; pastas do sistema (`/`, `/etc`, `/usr`…) e a home não podem ser excluídas; aviso ao fechar com arquivos não salvos; se a conexão cair, as abas continuam abertas para reconectar e salvar.

## Arquitetura

```
src/
├─ main/        processo principal (Node): SSH, SFTP, terminal, armazenamento
│  ├─ store.ts      conexões + segredos criptografados + known hosts (userData/vps-hub.json)
│  ├─ sessions.ts   uma conexão SSH por VPS, verificação de host key
│  ├─ files.ts      operações SFTP e transferências
│  ├─ trash.ts      exclusão, lixeira e restauração
│  ├─ paste.ts      copiar/recortar/colar (mesma VPS e entre VPS)
│  ├─ search.ts     busca por nome (find) e conteúdo (grep), com cancelamento
│  ├─ sshConfig.ts  leitura do ~/.ssh/config
│  ├─ terminals.ts  shells interativos
│  └─ ipc.ts        canais IPC
├─ preload/     ponte segura (contextIsolation) que expõe window.vpsApi
├─ renderer/    React: Hub, Workspace (Explorer, Editor, Terminal, Transferências)
└─ shared/      tipos e utilitários de caminho usados pelos dois lados
```

O renderer nunca recebe senhas nem chaves; tudo que envolve credenciais fica no processo principal.
