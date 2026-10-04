import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMoney } from '../lib/alt'
import { useCart } from '../lib/cart'
import { useSeo } from '../lib/seo'
import { Container } from '../components/ui/Container'
import { Reveal } from '../components/ui/Reveal'
import { Button, ButtonLink } from '../components/ui/Button'
import { AddToCalendar } from '../components/AddToCalendar'
import { cairoIso } from '../lib/calendar'
import { AddToWallet } from '../components/AddToWallet'

function generateReference() {
  return `AZP-${Date.now().toString(36).toUpperCase().slice(-6)}`
}

function Field({
  label,
  type,
  required,
  value,
  onChange,
}: {
  label: string
  type: string
  required?: boolean
  value?: string
  onChange?: (v: string) => void
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-ink-900/50">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="mt-2 w-full rounded-xl border border-ink-900/15 bg-sand-50 px-4 py-3 text-sm text-ink-900 outline-none focus:border-teal-700"
      />
    </div>
  )
}

export function Checkout() {
  const { t } = useTranslation()
  const money = useMoney()
  const { lines, totalPrice, clear } = useCart()
  useSeo({
    title: t('checkout'),
    description: t('orderSummary'),
    path: '/checkout',
  })

  const [submitted, setSubmitted] = useState<{ name: string; ref: string; visitDate: string | null } | null>(null)
  const [name, setName] = useState('')

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const ref = generateReference()
    const visitDate = lines.find((l) => l.visitDate)?.visitDate ?? null
    setSubmitted({ name, ref, visitDate })
    clear()
  }

  if (submitted) {
    return (
      <Container className="flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
        <Reveal>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teal-50 text-3xl">✓</div>
          <h1 className="font-display mt-6 text-3xl font-medium text-ink-900">{t('requestReceivedTitle')}</h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-ink-900/70">
            {t('requestReceivedBody', { name: submitted.name, ref: submitted.ref })}
          </p>
          <div className="mx-auto mt-8 w-full max-w-md space-y-6 rounded-2xl border border-ink-900/10 bg-sand-100 p-6 text-start">
            <AddToWallet reference={submitted.ref} />
            {submitted.visitDate ? (
              <AddToCalendar
                filename={`al-azhar-park-${submitted.visitDate}`}
                entry={{
                  title: `${t('visitReminder')} (${submitted.ref})`,
                  location: 'Al-Azhar Park, Salah Salem Street, Cairo',
                  start: cairoIso(submitted.visitDate, 10 * 60),
                  end: cairoIso(submitted.visitDate, 17 * 60),
                }}
              />
            ) : null}
          </div>
          <ButtonLink to="/" className="mt-8">
            {t('backToHome')}
          </ButtonLink>
        </Reveal>
      </Container>
    )
  }

  if (lines.length === 0) {
    return (
      <Container className="flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
        <h1 className="font-display text-2xl font-medium text-ink-900">{t('emptyCheckoutTitle')}</h1>
        <p className="mt-3 text-base text-ink-900/60">{t('emptyCheckoutBody')}</p>
        <ButtonLink to="/tickets" className="mt-8">
          {t('browseTickets')}
        </ButtonLink>
      </Container>
    )
  }

  return (
    <Container className="py-16 md:py-24">
      <Reveal>
        <h1 className="font-display text-3xl font-medium text-ink-900 md:text-4xl">{t('checkout')}</h1>
      </Reveal>

      <div className="mt-10 grid gap-12 md:grid-cols-[1fr_1.2fr]">
        <Reveal className="order-2 md:order-1">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{t('orderSummary')}</h2>
          <ul className="mt-4 divide-y divide-ink-900/10 rounded-2xl border border-ink-900/10">
            {lines.map((line) => (
              <li key={`${line.ticketId}__${line.visitDate ?? 'any'}`} className="flex items-center justify-between gap-4 px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-ink-900">{line.label}</p>
                  <p className="text-xs text-ink-900/50">
                    {t('quantity')}: {line.qty}
                    {line.visitDate ? ` · ${line.visitDate}` : ''}
                  </p>
                </div>
                <p className="text-sm font-semibold text-ink-900" dir="ltr">
                  {money(line.unitPrice * line.qty)}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-sand-100 px-5 py-4 text-base font-semibold text-ink-900">
            <span>{t('subtotal')}</span>
            <span dir="auto">{money(totalPrice)}</span>
          </div>
        </Reveal>

        <Reveal delay={0.1} className="order-1 md:order-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{t('contactDetails')}</h2>
          <form onSubmit={handleSubmit} className="mt-4 space-y-5">
            <Field label={t('fullName')} value={name} onChange={setName} type="text" required />
            <Field label={t('email')} type="email" required />
            <Field label={t('phone')} type="tel" />
            <div>
              <label htmlFor="checkout-notes" className="text-xs font-semibold uppercase tracking-wide text-ink-900/50">
                {t('specialRequests')}
              </label>
              <textarea
                id="checkout-notes"
                rows={3}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-sand-50 px-4 py-3 text-sm text-ink-900 outline-none focus:border-teal-700"
              />
            </div>
            <p className="rounded-xl border border-gold-500/30 bg-gold-100/40 px-4 py-3 text-xs leading-relaxed text-ink-900/70">
              {t('requestNote')}
            </p>
            <Button type="submit" className="w-full justify-center">
              {t('submitRequest')}
            </Button>
          </form>
        </Reveal>
      </div>
    </Container>
  )
}
