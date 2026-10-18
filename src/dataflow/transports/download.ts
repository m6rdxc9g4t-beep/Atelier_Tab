/** Téléchargement d'un fichier généré dans le navigateur. */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Nom de fichier sûr : « Planning & Lots » → « planning-lots ». */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'export'
  )
}

export function exportFilename(tableName: string, ext: 'json' | 'csv', at = new Date()): string {
  const stamp = at.toISOString().slice(0, 10)
  return `atelier_projets_${slugify(tableName)}_${stamp}.${ext}`
}
