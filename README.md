# VPS Hub

App desktop (Electron) para gerenciar várias VPS e navegar pelos arquivos delas como no Explorer do Windows, via SSH/SFTP.

## Rodando

```bash
npm install
npm run dev        # desenvolvimento (F12 abre o DevTools)
npm run build      # build de produção em out/
npm run dist       # instalador Windows em dist/
npm run typecheck
```

## Funcionalidades (Fase 1)

- **Hub**: cadastrar, editar, duplicar e excluir conexões; testar a conexão antes de salvar; status online/latência; filtro por tags e busca.
- **Autenticação**: senha ou chave privada (OpenSSH ou .ppk, com passphrase). Senhas e passphrases podem ser lembradas, criptografadas pelo Windows (DPAPI via `safeStorage`); se não estiverem salvas, o app pede na hora de conectar.
- **Host key**: na primeira conexão o fingerprint é exibido para confirmação; se mudar depois, o app avisa (possível ataque man-in-the-middle).
- **Explorer**: navegação com histórico, breadcrumb editável (Ctrl+L, aceita `~`), acesso rápido, ordenação, filtro, arquivos ocultos, multisseleção, menu de contexto e atalhos (F2, Del, F5, Enter, Alt+←/→/↑, Ctrl+A, Ctrl+Shift+N).
- **Editor** (Monaco): abas, Ctrl+S, detecção de conflito se o arquivo mudou no servidor, gravação atômica (arquivo temporário + rename), recusa binários, arquivos não UTF-8 e arquivos acima de 5 MB.
- **Transferências**: upload (botão ou arrastar do Windows, inclusive pastas) e download, com progresso.
- **Terminal** integrado (xterm.js), aberto na pasta atual.
- **Proteções**: confirmação para excluir; pastas do sistema (`/`, `/etc`, `/usr`…) e a home não podem ser excluídas; aviso ao fechar com arquivos não salvos; se a conexão cair, as abas continuam abertas para reconectar e salvar.

## Arquitetura

```
src/
├─ main/        processo principal (Node): SSH, SFTP, terminal, armazenamento
│  ├─ store.ts      conexões + segredos criptografados + known hosts (userData/vps-hub.json)
│  ├─ sessions.ts   uma conexão SSH por VPS, verificação de host key
│  ├─ files.ts      operações SFTP e transferências
│  ├─ terminals.ts  shells interativos
│  └─ ipc.ts        canais IPC
├─ preload/     ponte segura (contextIsolation) que expõe window.vpsApi
├─ renderer/    React: Hub, Workspace (Explorer, Editor, Terminal, Transferências)
└─ shared/      tipos e utilitários de caminho usados pelos dois lados
```

O renderer nunca recebe senhas nem chaves; tudo que envolve credenciais fica no processo principal.
