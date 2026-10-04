import type { ElementType, ReactNode } from 'react'
import clsx from 'clsx'

export function Container({
  children,
  className,
  as: As = 'div',
}: {
  children: ReactNode
  className?: string
  as?: ElementType
}) {
  return <As className={clsx('mx-auto w-full max-w-6xl px-6 md:px-10', className)}>{children}</As>
}
