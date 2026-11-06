import { ENCODING_LABEL } from '../shared/encoding'
import type { TextEncoding } from '../shared/types'
import { AppError } from './errors'

/**
 * Texto do editor: UTF-8 (padrão), UTF-16 com BOM e Windows-1252 (o que sobra de arquivos "latin1"/ANSI).
 * O arquivo volta ao servidor na mesma codificação em que foi lido, então abrir e salvar não corrompe nada.
 * O BOM é mantido no texto (U+FEFF) para ser regravado como estava.
 */

/** Windows-1252 decodifica os 256 bytes, então o mapa inverso permite regravar sem perdas. */
const CP1252_DECODER = new TextDecoder('windows-1252')
let cp1252Reverse: Map<string, number> | undefined
function cp1252Bytes(): Map<string, number> {
  if (!cp1252Reverse) {
    cp1252Reverse = new Map()
    for (let b = 0; b < 256; b++) cp1252Reverse.set(CP1252_DECODER.decode(Uint8Array.of(b)), b)
  }
  return cp1252Reverse
}

export function decodeText(buf: Buffer): { text: string; encoding: TextEncoding } {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le', { ignoreBOM: true }).decode(buf), encoding: 'utf-16le' }
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be', { ignoreBOM: true }).decode(buf), encoding: 'utf-16be' }
  if (buf.subarray(0, 8000).includes(0)) throw new AppError('Arquivo binário não pode ser editado. Use "Baixar".')
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf), encoding: 'utf-8' }
  } catch {
    return { text: CP1252_DECODER.decode(buf), encoding: 'windows-1252' }
  }
}

export function encodeText(text: string, encoding: TextEncoding): Buffer {
  switch (encoding) {
    case 'utf-8':
      return Buffer.from(text, 'utf8')
    case 'utf-16le':
      return Buffer.from(text, 'utf16le')
    case 'utf-16be':
      return Buffer.from(text, 'utf16le').swap16()
    case 'windows-1252': {
      const map = cp1252Bytes()
      const out = Buffer.alloc(text.length)
      let n = 0
      for (const ch of text) {
        const b = map.get(ch)
        if (b === undefined) {
          throw new AppError(`O caractere "${ch}" não existe em ${ENCODING_LABEL[encoding]}, a codificação deste arquivo. Remova-o para salvar.`)
        }
        out[n++] = b
      }
      return out.subarray(0, n)
    }
    default:
      throw new AppError('Codificação inválida.')
  }
}

export const isTextEncoding = (v: unknown): v is TextEncoding => typeof v === 'string' && v in ENCODING_LABEL
