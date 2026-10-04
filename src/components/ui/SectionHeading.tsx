import clsx from 'clsx'
import type { ReactNode } from 'react'
import { Reveal } from './Reveal'

export function Eyebrow({ children, tone = 'ink' }: { children: ReactNode; tone?: 'ink' | 'sand' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-3 font-sans text-xs font-semibold uppercase tracking-[0.22em]',
        tone === 'sand' ? 'text-gold-100' : 'text-gold-700',
      )}
    >
      <span className={clsx('h-px w-8', tone === 'sand' ? 'bg-gold-100' : 'bg-gold-600')} aria-hidden="true" />
      {children}
    </span>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  body,
  tone = 'ink',
  align = 'start',
  className,
}: {
  eyebrow: string
  title: string
  body?: string
  tone?: 'ink' | 'sand'
  align?: 'start' | 'center'
  className?: string
}) {
  return (
    <Reveal className={clsx('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
      <h2
        className={clsx(
          'font-display mt-4 text-3xl leading-[1.15] font-medium md:text-4xl',
          tone === 'sand' ? 'text-sand-50' : 'text-ink-900',
        )}
      >
        {title}
      </h2>
      {body ? (
        <p className={clsx('mt-4 text-base leading-relaxed md:text-lg', tone === 'sand' ? 'text-sand-100/85' : 'text-ink-900/70')}>
          {body}
        </p>
      ) : null}
    </Reveal>
  )
}
