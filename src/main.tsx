import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './lib/i18n'
import App from './App.tsx'
import { LanguageProvider } from './lib/language'
import { SiteDataProvider } from './lib/siteData'
import { CartProvider } from './lib/cart'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SiteDataProvider>
        <LanguageProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </LanguageProvider>
      </SiteDataProvider>
    </BrowserRouter>
  </StrictMode>,
)
