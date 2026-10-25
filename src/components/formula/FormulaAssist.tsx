import type { FunctionDoc } from '@/engine/formula'
import { cn } from '@/lib/cn'
import { syntaxParts } from './formula-suggest'

/** Syntaxe de la fonction en cours, argument courant en évidence. */
export function SignatureHint({ doc, arg }: { doc: FunctionDoc; arg: number }) {
  const { name, args } = syntaxParts(doc)
  // Fonctions variadiques (« nombre1; [nombre2]; … ») : les arguments suivants restent sur le dernier.
  const current = Math.min(arg, Math.max(args.length - 1, 0))
  return (
    <div className="px-3 py-2">
      <p className="font-mono text-ink">
        {name}(
        {args.map((a, i) => (
          <span key={i}>
            {i > 0 && '; '}
            <span
              className={cn(
                i === current ? 'font-semibold text-accent-fg underline' : 'text-muted',
              )}
            >
              {a}
            </span>
          </span>
        ))}
        )
      </p>
      <p className="mt-0.5 text-muted">{doc.description}</p>
    </div>
  )
}
