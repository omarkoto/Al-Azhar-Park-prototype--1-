import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/Button'
import { walletConfigured, walletUrl } from '../lib/wallet'

export function AddToWallet({ reference }: { reference: string }) {
  const { t } = useTranslation()
  const [notice, setNotice] = useState(false)

  function handle(kind: 'apple' | 'google') {
    if (walletConfigured) window.location.href = walletUrl(kind, reference)
    else setNotice(true)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/45">{t('addToWallet')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button className="justify-center bg-ink-900 hover:bg-ink-900/85" onClick={() => handle('apple')}>
          <WalletIcon />
          {t('appleWallet')}
        </Button>
        <Button className="justify-center bg-ink-900 hover:bg-ink-900/85" onClick={() => handle('google')}>
          <WalletIcon />
          {t('googleWallet')}
        </Button>
      </div>
      {notice ? (
        <p role="status" className="rounded-xl border border-gold-500/30 bg-gold-100/40 px-4 py-3 text-xs leading-relaxed text-ink-900/70">
          {t('walletDemoNote')}
        </p>
      ) : null}
    </div>
  )
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="5" width="15" height="11" rx="2" />
      <path d="M2.5 8h15M13.5 12h1.5" strokeLinecap="round" />
    </svg>
  )
}
