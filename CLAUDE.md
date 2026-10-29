# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VPS Hub: a Windows desktop app (Electron + React + TypeScript) that acts as a hub of SSH connections and a Windows-Explorer-like file manager for the selected VPS (SSH/SFTP via `ssh2`, Monaco editor, xterm.js terminal). See README.md for the feature list.

## Conventions

- Talk to the user in Portuguese (pt-BR). All UI text and user-facing error messages are pt-BR; code comments are pt-BR too.
- **Commit messages: English, Conventional Commits.** `type: imperative summary` with `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, etc.; optional body explaining why. Example: `fix: use async safeStorage API`.
- Electron is v45+: use the async `safeStorage` APIs (`encryptStringAsync`, `decryptStringAsync`, `isAsyncEncryptionAvailable`); the sync ones are deprecated.

## Commands

```bash
npm run dev        # electron-vite dev server + app (F12 toggles DevTools in dev)
npm run build      # production build into out/
npm run typecheck  # tsc --noEmit over src/ (single tsconfig for main, preload and renderer)
npm run dist       # build + electron-builder Windows installer into dist/
```

There is no linter and no test suite in the repo. Verify changes with `npm run typecheck` and `npm run build`, then exercise the real app. For end-to-end checks, a disposable SSH server works well:

```bash
docker run -d --name vpshub-ssh -p 2222:2222 -e PUID=1000 -e PGID=1000 -e USER_NAME=dev -e PASSWORD_ACCESS=true -e USER_PASSWORD=senha123 lscr.io/linuxserver/openssh-server:latest
```

(home is `/config`; add `-e PUBLIC_KEY=...` to test key auth). Drive the built app with `playwright-core`'s `_electron.launch({ args: [projectDir, '--user-data-dir=<tmp>'] })`; stub `dialog.showMessageBox` in the main process to accept the host-key prompt. Setting `USERPROFILE` in the launch env redirects `~/.ssh/config` lookups.

## Architecture

Three processes, standard electron-vite layout (`src/main`, `src/preload`, `src/renderer`) plus `src/shared` (types and POSIX path helpers used by both sides).

**Trust boundary.** Only the main process touches credentials, the network and the filesystem. The renderer never receives passwords or keys (`VpsConnection` exposes only `hasSecret`). Window runs with `contextIsolation`, `sandbox`, no node integration, no app menu (avoids Ctrl+R/Ctrl+W discarding edits), and navigation blocked.

**IPC contract.** `VpsApi` in `src/shared/types.ts` is the single source of truth. Adding an operation means touching three places: the type in `types.ts`, a `handle('channel', fn)` in `src/main/ipc.ts`, and the mapping in `src/preload/index.ts`. `handle` wraps results as `Result<T>`; the preload unwraps and rejects with a **plain `ApiErrorShape` object `{ message, code }`, not an `Error`**, because `contextBridge` strips extra properties from `Error`s. In the renderer, read errors only through `errMsg`/`errCode` (`src/renderer/src/lib/api.ts`). Error codes drive UI flows: `SECRET_REQUIRED` (prompt for password/passphrase and retry, see `lib/connect.ts`), `CONFLICT` (file changed on server), `AUTH_METHOD`, `NOT_CONNECTED`. Main → renderer events go through `emit()` (`session:closed`, `transfer:progress`, `terminal:data`, `terminal:exit`).

**Main process modules.**
- `store.ts`: connections + encrypted secrets + known host fingerprints in `userData/vps-hub.json` (atomic write; a corrupt file is renamed aside, never overwritten). `cleanFields` validates all connection input.
- `sessions.ts`: one live `ssh2` client + SFTP channel per VPS id. Host keys are verified with a native dialog (first use / changed key). Auth uses an `authHandler` that first tries `none` to learn the server's accepted methods so it can explain failures. `exec()`/`sh()` (throws with stderr on failure) and `shellQuote()` are the only way to run shell commands; always quote paths.
- `files.ts`: SFTP operations and transfers. `remotePath()` validates/normalizes every path coming from the renderer. Saves are atomic (temp file + `posix-rename`) only when the file is owned by the session uid, and check `mtime` for conflicts. The editor refuses binaries, non-UTF-8 and >5 MB files.
- `trash.ts`: owns deletion. `fs:remove` moves items to `~/.vpshub-trash/<id>/` (with a metadata JSON holding the original path) unless `permanent`; protected system dirs, the home dir and its ancestors can never be deleted. Restore never overwrites.
- `paste.ts`: copy/cut/paste. Same VPS runs `cp -a`/`mv` on the server; across VPS it streams SFTP → SFTP through the app (recreating symlinks, keeping modes) and deletes the source only after a full copy. Replaced items go to the trash; cut uses the same `assertRemovable` guard as delete. The renderer's clipboard lives in the Zustand store so it can be pasted into another VPS's workspace.
- `terminals.ts`: interactive shells via `exec` with a PTY (`cd <dir>; exec $SHELL -l`); cleaned up through `onSessionEnd`.
- `sshConfig.ts`: parses `~/.ssh/config` with OpenSSH semantics (first value wins, `Host *` defaults, negated patterns; `Match` blocks ignored).

**Renderer.** Zustand store (`lib/store.ts`) holds connections, sessions, dirty-file counts, transfers and toasts. `App.tsx` keeps **one `Workspace` mounted per connected session** and only hides inactive ones, so switching VPS or going back to the Hub preserves editor tabs, terminals and explorer state. A dropped connection marks the session `closed` (workspace stays open with a reconnect banner) instead of removing it, so unsaved edits survive. Confirm/prompt dialogs are promise-based (`lib/dialogs.ts` + `DialogHost`). Monaco is bundled locally (no CDN) with Vite workers in `lib/monaco.ts`; models are keyed per VPS + path via `modelUri` and must be disposed with `disposeModel` when a tab closes. Unsaved files block window close through `beforeunload` → main's `will-prevent-unload` dialog.
