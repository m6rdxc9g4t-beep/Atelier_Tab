import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'

export function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  const label = resolved === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-ink"
    >
      {resolved === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}
