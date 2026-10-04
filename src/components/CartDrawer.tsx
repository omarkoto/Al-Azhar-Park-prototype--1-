import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMoney } from '../lib/alt'
import { AnimatePresence, motion } from 'framer-motion'
import { useCart } from '../lib/cart'
import { Button } from './ui/Button'

export function CartDrawer() {
  const { isOpen, close, lines, totalPrice, updateQty, removeLine } = useCart()
  const { t } = useTranslation()
  const money = useMoney()
  const navigate = useNavigate()
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    closeButtonRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, close])

  return (
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.div
            className="fixed inset-0 z-[70] bg-ink-900/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={t('yourCart')}
            className="fixed inset-y-0 end-0 z-[71] flex w-full max-w-md flex-col bg-sand-50 shadow-2xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-center justify-between border-b border-ink-900/10 px-6 py-5">
              <h2 className="font-display text-lg font-medium text-ink-900">{t('yourCart')}</h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label={t('close')}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-ink-900/15 text-ink-900/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-600"
              >
                ✕
              </button>
            </div>

            {lines.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-base font-medium text-ink-900">{t('cartEmpty')}</p>
                <p className="text-sm text-ink-900/60">{t('cartEmptyBody')}</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <ul className="space-y-5">
                  <AnimatePresence initial={false}>
                    {lines.map((line) => (
                      <motion.li
                        key={`${line.ticketId}__${line.visitDate ?? 'any'}`}
                        layout
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-start justify-between gap-4 border-b border-ink-900/10 pb-5"
                      >
                        <div>
                          <p className="text-sm font-semibold text-ink-900">{line.label}</p>
                          {line.visitDate ? <p className="mt-0.5 text-xs text-ink-900/50">{line.visitDate}</p> : null}
                          <div className="mt-3 flex items-center gap-2">
                            <QtyButton
                              label="-"
                              onClick={() => updateQty(line.ticketId, line.visitDate, line.qty - 1)}
                            />
                            <span className="w-6 text-center text-sm font-medium">{line.qty}</span>
                            <QtyButton
                              label="+"
                              onClick={() => updateQty(line.ticketId, line.visitDate, line.qty + 1)}
                            />
                            <button
                              type="button"
                              onClick={() => removeLine(line.ticketId, line.visitDate)}
                              className="ms-3 text-xs font-semibold text-ink-900/40 underline-offset-2 hover:text-red-700 hover:underline"
                            >
                              {t('remove')}
                            </button>
                          </div>
                        </div>
                        <p className="whitespace-nowrap text-sm font-semibold text-ink-900" dir="ltr">
                          {money(line.unitPrice * line.qty)}
                        </p>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            )}

            <div className="border-t border-ink-900/10 px-6 py-5">
              <div className="flex items-center justify-between text-base font-semibold text-ink-900">
                <span>{t('subtotal')}</span>
                <span dir="auto">{money(totalPrice)}</span>
              </div>
              <Button
                className="mt-4 w-full justify-center"
                disabled={lines.length === 0}
                onClick={() => {
                  close()
                  navigate('/checkout')
                }}
              >
                {t('checkout')}
              </Button>
              <button
                type="button"
                onClick={close}
                className="mt-3 w-full text-center text-sm font-semibold text-ink-900/60 hover:text-ink-900"
              >
                {t('continueShopping')}
              </button>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  )
}

function QtyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full border border-ink-900/20 text-sm text-ink-900/70 hover:border-teal-700 hover:text-teal-700"
    >
      {label}
    </button>
  )
}
