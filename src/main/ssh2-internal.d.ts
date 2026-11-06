// O ssh2 não exporta a classe SFTP; o modo sudo a usa sobre um canal exec (ver sudo.ts).
declare module 'ssh2/lib/protocol/SFTP.js' {
  import type { Client, SFTPWrapper } from 'ssh2'
  export const SFTP: new (client: Client, chanInfo: object, cfg: object) => SFTPWrapper & { _init(): void }
}
