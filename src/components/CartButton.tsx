import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useCart } from '../lib/cart'

export function CartButton({ id }: { id: string }) {
  const { totalCount, open } = useCart()
  const { t } = useTranslation()

  return (
    <button
      type="button"
      id={id}
      data-cart-icon-target
      onClick={open}
      aria-label={t('cart')}
      className="group relative flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-teal-800 transition-colors hover:bg-teal-100"
    >
      {/* A ticket (with its notched edges and perforation) carried like a shopping bag */}
      <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8.6 8.4V7a3.4 3.4 0 0 1 6.8 0v1.4" className="origin-bottom transition-transform duration-300 group-hover:-translate-y-0.5" />
        <path d="M3.5 8.5h17V12a1.5 1.5 0 0 0 0 3v3.5h-17V15a1.5 1.5 0 0 0 0-3Z" className="fill-teal-50/0 transition-colors group-hover:fill-gold-500/20" />
        <path d="M15.2 10.2v6.6" strokeDasharray="1.2 2" />
        <path d="m9 11.4.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6Z" fill="currentColor" stroke="none" className="text-gold-600" />
      </svg>
      <AnimatePresence>
        {totalCount > 0 ? (
          <motion.span
            key={totalCount}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 20 }}
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gold-600 text-[10px] font-bold text-teal-950 rtl:-left-1.5 rtl:right-auto"
          >
            {totalCount}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </button>
  )
}
