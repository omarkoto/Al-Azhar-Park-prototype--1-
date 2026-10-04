import clsx from 'clsx'
import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'

const base =
  'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold tracking-wide transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-600 disabled:cursor-not-allowed disabled:opacity-50'

const variants = {
  primary: 'bg-teal-700 text-sand-50 hover:bg-teal-600',
  ghost: 'border border-current/25 text-inherit hover:border-current/60',
  gold: 'bg-gold-600 text-teal-950 hover:bg-gold-500',
}

type Variant = keyof typeof variants

export function ButtonLink({
  to,
  variant = 'primary',
  className,
  children,
}: {
  to: string
  variant?: Variant
  className?: string
  children: ReactNode
}) {
  return (
    <Link to={to} className={clsx(base, variants[variant], className)}>
      {children}
    </Link>
  )
}

export function ExternalLink({
  href,
  variant = 'primary',
  className,
  children,
  ...rest
}: { href: string; variant?: Variant; className?: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} className={clsx(base, variants[variant], className)} {...rest}>
      {children}
    </a>
  )
}

export const Button = forwardRef<
  HTMLButtonElement,
  { variant?: Variant; className?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>
>(function Button({ variant = 'primary', className, children, ...rest }, ref) {
  return (
    <button ref={ref} className={clsx(base, variants[variant], className)} {...rest}>
      {children}
    </button>
  )
})
