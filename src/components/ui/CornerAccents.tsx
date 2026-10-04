import clsx from 'clsx'

export function CornerAccents({ className }: { className?: string }) {
  return (
    <>
      <span className={clsx('pointer-events-none absolute -start-2 -top-2 h-6 w-6 border-t-2 border-s-2 border-gold-500/70', className)} aria-hidden="true" />
      <span className={clsx('pointer-events-none absolute -end-2 -top-2 h-6 w-6 border-t-2 border-e-2 border-gold-500/70', className)} aria-hidden="true" />
      <span className={clsx('pointer-events-none absolute -start-2 -bottom-2 h-6 w-6 border-b-2 border-s-2 border-gold-500/70', className)} aria-hidden="true" />
      <span className={clsx('pointer-events-none absolute -end-2 -bottom-2 h-6 w-6 border-b-2 border-e-2 border-gold-500/70', className)} aria-hidden="true" />
    </>
  )
}
