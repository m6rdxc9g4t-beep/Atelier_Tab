/** Texte des pastilles « Ollama » / « Claude » (vert = disponible, détail en info-bulle). */
import type { ClaudeStatus } from '@/ai/claude'
import type { ModelsResult } from '@/ai/ollama'

export function ollamaBadge(res: ModelsResult | null): { available: boolean; detail: string } {
  if (!res) return { available: false, detail: 'Ollama : vérification…' }
  if (!res.ok) return { available: false, detail: `Ollama indisponible — ${res.message}` }
  const usable = res.models.filter((m) => m.tools).length
  return usable > 0
    ? { available: true, detail: `Ollama prêt — ${usable} modèle${usable > 1 ? 's' : ''} à outils` }
    : { available: false, detail: 'Ollama : aucun modèle ne sait utiliser d’outils' }
}

export function claudeBadge(status: ClaudeStatus | null): { available: boolean; detail: string } {
  if (!status) return { available: false, detail: 'Claude : vérification…' }
  const available = status.online && status.available
  const version = status.version ? ` — CLI ${status.version}` : ''
  if (available) return { available, detail: `${status.detail ?? 'Claude prêt'}${version}` }
  return { available, detail: `${status.detail ?? 'Claude indisponible'}${version}` }
}
