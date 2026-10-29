export type AuthMethod = 'password' | 'key'

/** Campos editáveis de uma conexão (sem segredos). */
export interface VpsFields {
  name: string
  host: string
  port: number
  username: string
  auth: AuthMethod
  /** Caminho local da chave privada (somente quando auth === 'key'). */
  keyPath: string
  /** Pasta aberta ao conectar; vazio = home do usuário. */
  initialPath: string
  color: string
  tags: string[]
}

/** Conexão como o renderer a enxerga: nunca contém senha ou passphrase. */
export interface VpsConnection extends VpsFields {
  id: string
  hasSecret: boolean
  lastConnectedAt?: number
}

export interface VpsInput extends VpsFields {
  /** Senha (auth password) ou passphrase da chave (auth key). Vazio/ausente = manter a salva. */
  secret?: string
  rememberSecret: boolean
}

export interface SessionInfo {
  id: string
  user: string
  home: string
  os: string
}

export interface TestResult {
  os: string
  latencyMs: number
}

/** Host encontrado no ~/.ssh/config, pronto para virar uma conexão. */
export interface SshConfigHost {
  alias: string
  host: string
  port: number
  username: string
  auth: AuthMethod
  keyPath: string
  /** Motivo pelo qual a importação pode não funcionar como está. */
  warning?: string
}

/** Item na lixeira da VPS (~/.vpshub-trash). */
export interface TrashItem {
  id: string
  name: string
  originalPath: string
  /** Milissegundos desde epoch. */
  deletedAt: number
  isDir: boolean
  size: number
}

export interface FileEntry {
  name: string
  path: string
  type: 'dir' | 'file' | 'link'
  /** Diretório ou link que aponta para diretório. */
  isDir: boolean
  size: number
  /** Segundos desde epoch, como o SFTP informa. */
  mtime: number
  perms: string
  owner: string
}

export interface FileContent {
  content: string
  mtime: number
}

export interface TransferEvent {
  id: string
  vpsId: string
  name: string
  direction: 'up' | 'down'
  transferred: number
  total: number
  status: 'running' | 'done' | 'error'
  error?: string
}

export interface ApiErrorShape {
  message: string
  code?: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiErrorShape }

export type Unsubscribe = () => void

/** API exposta pelo preload em window.vpsApi. As Promises rejeitam com ApiErrorShape. */
export interface VpsApi {
  connections: {
    list(): Promise<VpsConnection[]>
    save(input: VpsInput, id?: string): Promise<VpsConnection>
    remove(id: string): Promise<void>
    test(input: VpsInput, id?: string): Promise<TestResult>
    probe(id: string): Promise<number | null>
    pickKeyFile(): Promise<string | null>
    readSshConfig(): Promise<SshConfigHost[]>
  }
  session: {
    connect(id: string, secret?: string): Promise<SessionInfo>
    disconnect(id: string): Promise<void>
    onClosed(cb: (id: string) => void): Unsubscribe
  }
  fs: {
    list(id: string, path: string): Promise<FileEntry[]>
    read(id: string, path: string): Promise<FileContent>
    /** expectedMtime null = sobrescrever sem checar conflito. Retorna o novo mtime. */
    write(id: string, path: string, content: string, expectedMtime: number | null): Promise<number>
    createFile(id: string, path: string): Promise<void>
    mkdir(id: string, path: string): Promise<void>
    rename(id: string, from: string, to: string): Promise<void>
    /** Move para a lixeira (retorna os ids na lixeira) ou, se permanent, apaga de vez. */
    remove(id: string, paths: string[], permanent: boolean): Promise<string[]>
    pickUpload(): Promise<string[]>
    upload(id: string, localPaths: string[], remoteDir: string): Promise<void>
    /** Pergunta a pasta local de destino; retorna null se cancelado. */
    download(id: string, remotePaths: string[]): Promise<string | null>
    revealLocal(path: string): Promise<void>
    pathForFile(file: File): string
  }
  trash: {
    list(id: string): Promise<TrashItem[]>
    restore(id: string, trashIds: string[]): Promise<void>
    /** Apaga de vez os itens indicados; sem trashIds, esvazia a lixeira. */
    purge(id: string, trashIds?: string[]): Promise<void>
  }
  transfers: {
    onProgress(cb: (e: TransferEvent) => void): Unsubscribe
  }
  terminal: {
    open(termId: string, vpsId: string, cwd: string, cols: number, rows: number): Promise<void>
    write(termId: string, data: string): void
    resize(termId: string, cols: number, rows: number): void
    close(termId: string): void
    onData(cb: (termId: string, data: string) => void): Unsubscribe
    onExit(cb: (termId: string) => void): Unsubscribe
  }
}
