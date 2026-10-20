import { useId, useRef } from 'react'
import { Table2 } from 'lucide-react'

import logo from '@/assets/logo-atelier-tab.webp'

/**
 * Marque commune de la Suite Atelier (styles/atelier-brand, docs/SUITE.md §1.6) :
 * tuile + « atelier_Tab » ; un clic ouvre la fenêtre « À propos » avec le logo en grand.
 */
export function AtelierBrand({
  showName = true,
  nameClassName = '',
}: {
  showName?: boolean
  nameClassName?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  return (
    <>
      <button
        type="button"
        className="atelier-brand"
        aria-haspopup="dialog"
        aria-label={showName ? undefined : "À propos d'Atelier Tab"}
        title="À propos d'Atelier Tab"
        onClick={() => dialog.current?.showModal()}
      >
        <span className="atelier-brand__tile" aria-hidden="true">
          <Table2 />
        </span>
        {showName && (
          <span className={`atelier-brand__name ${nameClassName}`}>
            <span className="atelier-brand__prefix">atelier_</span>Tab
          </span>
        )}
      </button>

      <dialog
        ref={dialog}
        className="atelier-about"
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close()
        }}
      >
        <div className="atelier-about__panel">
          <button
            type="button"
            className="atelier-about__close"
            aria-label="Fermer"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
          <img
            className="atelier-about__logo"
            src={logo}
            alt="Logo Atelier Tab"
            width={537}
            height={576}
          />
          <h2 id={titleId} className="atelier-about__name">
            <span className="atelier-brand__prefix">atelier_</span>Tab
          </h2>
          <p className="atelier-about__tagline">
            Tableur et base de données dans un même espace de travail, avec envoi direct vers
            Atelier Projets.
          </p>
          <p className="atelier-about__suite">Suite Atelier · 100 % local</p>
        </div>
      </dialog>
    </>
  )
}
