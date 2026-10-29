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
npm run dist       # build + electron-builder Windows installer into dist/ ("VPS Hub Setup <version>.exe", unsigned)
npm run test:e2e   # build + end-to-end suites against real SSH servers in Docker (Docker Desktop must be running)
```

There is no linter and no unit-test suite. Verify changes with `npm run typecheck`, then `npm run test:e2e` (about 2 minutes). To run one suite or test, `npm run build` first, then:

```bash
node --test --test-global-setup=tests/e2e/setup.mjs tests/e2e/paste.test.mjs
node --test --test-global-setup=tests/e2e/setup.mjs --test-name-pattern="lixeira" tests/e2e/import-trash.test.mjs
```

**E2E harness (`tests/e2e/`).** `setup.mjs` (node --test global setup) generates a passphrase-protected test key and starts two `linuxserver/openssh-server` containers (`vpshub-e2e-a` on port 22220, `vpshub-e2e-b` on 22221; user `dev`, home `/config`, BusyBox userland), writing ports and secrets to a temp state file read via `state()`; set `VPSHUB_E2E_KEEP=1` to keep the containers for debugging. `helpers.mjs` launches the built app through `playwright-core`'s `_electron` with an isolated `--user-data-dir`, replaces native dialogs (host key accepted, folder picker returns a temp dir), and provides `dockerSh` (runs `sh -c` in the container without a local shell, so only one quoting level; in these containers sshd itself runs as `dev`, so group changes need a container restart before sessions see them), `callApi` (calls `window.vpsApi`; rejections come back as `{ error, code }`) and `eventually` (retry instead of fixed sleeps). Setting `USERPROFILE` in the launch env redirects `~/.ssh/config` lookups. Each suite launches the app fresh and resets its own directories; add scenarios for new features to the matching suite. Screenshots go to `tests/e2e/.output/` (ignored).

## Architecture

Three processes, standard electron-vite layout (`src/main`, `src/preload`, `src/renderer`) plus `src/shared` (types and POSIX path helpers used by both sides).

**Trust boundary.** Only the main process touches credentials, the network and the filesystem. The renderer never receives passwords or keys (`VpsConnection` exposes only `hasSecret`). Window runs with `contextIsolation`, `sandbox`, no node integration, no app menu (avoids Ctrl+R/Ctrl+W discarding edits), and navigation blocked.

**IPC contract.** `VpsApi` in `src/shared/types.ts` is the single source of truth. Adding an operation means touching three places: the type in `types.ts`, a `handle('channel', fn)` in `src/main/ipc.ts`, and the mapping in `src/preload/index.ts`. `handle` wraps results as `Result<T>`; the preload unwraps and rejects with a **plain `ApiErrorShape` object `{ message, code }`, not an `Error`**, because `contextBridge` strips extra properties from `Error`s. In the renderer, read errors only through `errMsg`/`errCode` (`src/renderer/src/lib/api.ts`). Error codes drive UI flows: `SECRET_REQUIRED` (prompt for password/passphrase and retry, see `lib/connect.ts`), `CONFLICT` (file changed on server), `AUTH_METHOD`, `NOT_CONNECTED`. Main → renderer events go through `emit()` (`session:closed`, `transfer:progress`, `terminal:data`, `terminal:exit`).

**Main process modules.**
- `store.ts`: connections + encrypted secrets + known host fingerprints in `userData/vps-hub.json` (atomic write; a corrupt file is renamed aside, never overwritten). `cleanFields` validates all connection input.
- `sessions.ts`: one live `ssh2` client + SFTP channel per VPS id. Host keys are verified with a native dialog (first use / changed key). Auth uses an `authHandler` that first tries `none` to learn the server's accepted methods so it can explain failures. `exec()`/`sh()` (throws with stderr on failure) and `shellQuote()` are the only way to run shell commands; always quote paths.
- `files.ts`: SFTP operations and transfers. `remotePath()` validates/normalizes every path coming from the renderer. Saves are atomic (temp file + `posix-rename`) only when the file is owned by the session uid, and check `mtime` for conflicts. The editor refuses binaries, non-UTF-8 and >5 MB files.
- `trash.ts`: owns deletion. `fs:remove` moves items to `~/.vpshub-trash/<id>/` (with a metadata JSON holding the original path) unless `permanent`; protected system dirs, the home dir and its ancestors can never be deleted. Restore never overwrites.
- `archive.ts`: compress (`tar -czf` / `zip -r -y`, items passed as `./name`) and extract. Before extracting it lists entries (`tar -t`, `unzip -l`, parsed the same way for Info-ZIP and BusyBox) and refuses absolute or `..` entries; extraction uses `tar -o` so a root session does not restore archived owners. "here" mode reports top-level clashes as `EXISTS` and, with `replace`, trashes them first. A missing `zip`/`unzip` raises `MISSING_TOOL`; `toolInstallInfo`/`installTool` detect the package manager (apt-get, dnf, yum, apk, pacman, zypper) and install as root or via `sudo -n` (passwordless sudo only; apt runs non-interactive and retries after `apt-get update`). Note BusyBox tar silently strips `../` while GNU tar lists it, so the zip-slip test covers both.
- `paste.ts`: copy/cut/paste. Same VPS runs `cp -a`/`mv` on the server; across VPS it streams SFTP → SFTP through the app (recreating symlinks, keeping modes) and deletes the source only after a full copy. Replaced items go to the trash; cut uses the same `assertRemovable` guard as delete. The renderer's clipboard lives in the Zustand store so it can be pasted into another VPS's workspace.
- `perms.ts`: chmod/chown/chgrp. The renderer sends bits to set/clear (`PermChange`), applied as a symbolic mode (`u+x,g-w`) so untouched bits keep each item's own value across multi-selection and recursion; a typed numeric mode marks all 9 bits as changed (absolute). Recursive changes on `PROTECTED` paths are refused; per-item failures are collected and reported together.
- `search.ts`: runs `find`/`grep` over `exec`, parsing NUL-delimited records (`path\0line:text\n`) from raw bytes. Uses GNU grep (`-Z -I`) when present and a BusyBox-compatible shell loop otherwise, so test both (Alpine containers ship BusyBox; `apk add grep` gives GNU). Searches are cancellable by id (signal + channel close) and capped at 500 results.
- `terminals.ts`: interactive shells via `exec` with a PTY (`cd <dir>; exec $SHELL -l`); cleaned up through `onSessionEnd`.
- `sshConfig.ts`: parses `~/.ssh/config` with OpenSSH semantics (first value wins, `Host *` defaults, negated patterns; `Match` blocks ignored).

**Renderer.** Zustand store (`lib/store.ts`) holds connections, sessions, dirty-file counts, transfers and toasts. `App.tsx` keeps **one `Workspace` mounted per connected session** and only hides inactive ones, so switching VPS or going back to the Hub preserves editor tabs, terminals and explorer state. A dropped connection marks the session `closed` (workspace stays open with a reconnect banner) instead of removing it, so unsaved edits survive. Confirm/prompt dialogs are promise-based (`lib/dialogs.ts` + `DialogHost`). The Explorer's central pane is a `view` state (`files` | `trash` | `search`); only `files` shows the listing. Monaco is bundled locally (no CDN) with Vite workers in `lib/monaco.ts`; models are keyed per VPS + path via `modelUri` and must be disposed with `disposeModel` when a tab closes. Unsaved files block window close through `beforeunload` → main's `will-prevent-unload` dialog.
