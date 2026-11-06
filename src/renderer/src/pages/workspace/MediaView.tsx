import { baseName, mediaInfo } from '../../../../shared/paths'

/** URL do arquivo servido em streaming pelo processo principal (ver main/media.ts). */
export const mediaUrl = (vpsId: string, path: string) => `vpshub-media://${vpsId}${encodeURI(path)}`

/** Reprodutor de áudio e vídeo, e leitor de PDF (o do Chromium, em um iframe). O arquivo vem em streaming com Range, então avançar não baixa tudo. */
export function MediaView({ vpsId, path }: { vpsId: string; path: string }) {
  const info = mediaInfo(baseName(path))
  const src = mediaUrl(vpsId, path)
  return (
    <div className="absolute inset-0 flex flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-center border-b border-line px-3">
        <span className="truncate font-mono text-xs text-muted" title={path}>
          {path}
        </span>
      </div>
      <div className={`flex min-h-0 flex-1 items-center justify-center ${info?.kind === 'pdf' ? '' : 'bg-black/40 p-4'}`}>
        {info?.kind === 'video' && <video src={src} controls autoPlay={false} className="max-h-full max-w-full" aria-label={baseName(path)} />}
        {info?.kind === 'pdf' && <iframe src={src} title={baseName(path)} className="h-full w-full rounded border-0 bg-white" />}
        {info?.kind === 'audio' && <audio src={src} controls className="w-full max-w-xl" aria-label={baseName(path)} />}
      </div>
    </div>
  )
}
