import { useCallback, useState } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { THEME_CHOICES, useTheme, type ThemePreference } from '@/hooks/useTheme'
import { Popover } from '@/components/ui/Popover'
import { cn } from '@/lib/cn'

const ICONS: Record<ThemePreference, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }

/** Choix du thème : Clair, Sombre ou Système (docs/SUITE.md §1.5). */
export function ThemeToggle() {
  const { preference, resolved, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const Icon = preference === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun
  const current = THEME_CHOICES.find((c) => c.value === preference)?.label ?? ''

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Thème : ${current}`}
        title={`Thème : ${current}`}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-ink"
      >
        <Icon size={15} />
      </button>
      <Popover open={open} onClose={close} align="end" className="min-w-36">
        <div role="menu" aria-label="Thème">
          {THEME_CHOICES.map(({ value, label }) => {
            const ItemIcon = ICONS[value]
            const checked = preference === value
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                onClick={() => {
                  setTheme(value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover',
                  checked ? 'text-ink' : 'text-muted',
                )}
              >
                <ItemIcon size={14} />
                <span className="flex-1">{label}</span>
                {checked && <Check size={13} className="text-accent-fg" />}
              </button>
            )
          })}
        </div>
      </Popover>
    </div>
  )
}
