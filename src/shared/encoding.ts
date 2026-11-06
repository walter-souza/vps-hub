import type { TextEncoding } from './types'

/** Nome exibido de cada codificação de texto que o editor entende. */
export const ENCODING_LABEL: Record<TextEncoding, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'windows-1252': 'Windows-1252'
}
