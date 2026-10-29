import { File, FileArchive, FileCode, FileCog, FileImage, FileJson, FileSymlink, FileText, Folder, FolderSymlink } from 'lucide-react'
import type { FileEntry } from '../../../shared/types'

const byExt: Record<string, typeof File> = {}
const add = (icon: typeof File, exts: string) => exts.split(' ').forEach((e) => (byExt[e] = icon))
add(FileCode, 'js mjs cjs ts tsx jsx py php rb go rs java c h cpp cs sh bash zsh html css scss vue svelte sql lua pl')
add(FileJson, 'json jsonc')
add(FileImage, 'png jpg jpeg gif svg webp ico bmp avif')
add(FileArchive, 'zip tar gz tgz bz2 xz 7z rar zst')
add(FileCog, 'conf cfg ini env toml yml yaml service lock')
add(FileText, 'md txt log csv rst')

export function FileIcon({ entry, size = 15 }: { entry: Pick<FileEntry, 'name' | 'type' | 'isDir'>; size?: number }) {
  if (entry.isDir) {
    const Icon = entry.type === 'link' ? FolderSymlink : Folder
    return <Icon size={size} className="shrink-0 text-amber-400" />
  }
  if (entry.type === 'link') return <FileSymlink size={size} className="shrink-0 text-sky-400" />
  const name = entry.name.toLowerCase()
  const ext = name.startsWith('.') && !name.slice(1).includes('.') ? name.slice(1) : name.slice(name.lastIndexOf('.') + 1)
  const Icon = byExt[ext] ?? File
  return <Icon size={size} className="shrink-0 text-muted" />
}
