import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/atelier-brand/atelier-brand.css'
import { App } from '@/app/App'
import { migrateLegacyPreference } from '@/hooks/useTheme'

// Ancienne préférence de thème propre à Tab → préférence commune à la suite (une seule fois).
migrateLegacyPreference()

const root = document.getElementById('root')
if (!root) throw new Error('Élément #root introuvable dans index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
