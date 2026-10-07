import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMoney } from '../lib/alt'
import { useCart } from '../lib/cart'
import {
  BookingError, cartSelection, createOrder, customerInput, customerProblems, fetchCatalog, fetchQuote, newIdempotencyKey, pounds, problemKey, saveOrderToken, type Catalog, type CustomerProblems, type Quote,
} from '../lib/booking'
import { useBookingFormat } from '../lib/bookingFormat'
import { API_URL } from '../lib/api'
import { useSeo } from '../lib/seo'
import { Container } from '../components/ui/Container'
import { Reveal } from '../components/ui/Reveal'
import { Button, ButtonLink } from '../components/ui/Button'
import { BookingNotes } from '../components/BookingNotes'

function Field({
  label,
  type,
  value,
  onChange,
  error,
  autoComplete,
  name,
}: {
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  error?: string
  autoComplete?: string
  name: string
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-ink-900/50">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-2 w-full rounded-xl border bg-sand-50 px-4 py-3 text-sm text-ink-900 outline-none focus:border-teal-700 ${error ? 'border-red-700/60' : 'border-ink-900/15'}`}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function Checkout() {
  const { t } = useTranslation()
  const money = useMoney()
  const f = useBookingFormat()
  const navigate = useNavigate()
  const { lines, clear, removeLine } = useCart()
  useSeo({ title: t('checkout'), description: t('orderSummary'), path: '/checkout' })

  const planned = useMemo(() => cartSelection(lines), [lines])
  const selection = 'selection' in planned ? planned.selection : null

  const [quote, setQuote] = useState<Quote | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoting, setQuoting] = useState(false)

  const [form, setForm] = useState({ fullName: '', email: '', phone: '', accepted: false })
  const [problems, setProblems] = useState<CustomerProblems>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  // one key per checkout attempt: pressing the button twice, or retrying after a dropped connection, returns the same order
  const idempotencyKey = useRef(newIdempotencyKey())

  // The prices on this page come from the server, every time: the cart only remembers WHAT was chosen.
  const selectionKey = selection ? JSON.stringify(selection) : ''
  useEffect(() => {
    if (!selection || !API_URL) {
      setQuote(null)
      return
    }
    const controller = new AbortController()
    setQuoting(true)
    setQuoteError(null)
    idempotencyKey.current = newIdempotencyKey()
    Promise.all([fetchQuote(selection, controller.signal), fetchCatalog(undefined, controller.signal)])
      .then(([q, c]) => {
        setQuote(q)
        setCatalog(c)
      })
      .catch((e: unknown) => {
        if ((e as Error).name === 'AbortError') return
        setQuote(null)
        setQuoteError(problemKey(e instanceof BookingError ? e.code : 'NETWORK'))
      })
      .finally(() => setQuoting(false))
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selection || !quote || placing) return
    const found = customerProblems(form)
    setProblems(found)
    if (Object.keys(found).length > 0) return
    setPlacing(true)
    setSubmitError(null)
    try {
      const created = await createOrder(selection, customerInput(form), f.lang, idempotencyKey.current)
      saveOrderToken(created.order.orderNumber, created.accessToken)
      clear()
      navigate(`/orders/${created.order.orderNumber}#k=${created.accessToken}`, { replace: true })
    } catch (err) {
      setSubmitError(problemKey(err instanceof BookingError ? err.code : 'NETWORK'))
      setPlacing(false)
    }
  }

  if (!API_URL) {
    return (
      <Container className="flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
        <div data-testid="booking-unavailable">
          <h1 className="font-display text-2xl font-medium text-ink-900">{t('bookUnavailableTitle')}</h1>
          <p className="mx-auto mt-3 max-w-md text-base text-ink-900/60">{t('bookUnavailableBody')}</p>
          <ButtonLink to="/contact" className="mt-8">
            {t('bookContactPark')}
          </ButtonLink>
        </div>
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

  const mixed = 'problem' in planned && (planned.problem === 'MIXED_DATE' || planned.problem === 'MIXED_AUDIENCE' || planned.problem === 'NO_DATE' || planned.problem === 'INVALID')

  return (
    <Container className="py-16 md:py-24">
      <Reveal>
        <h1 className="font-display text-3xl font-medium text-ink-900 md:text-4xl">{t('checkout')}</h1>
      </Reveal>

      <div className="mt-10 grid gap-12 md:grid-cols-[1fr_1.2fr]">
        <Reveal className="order-2 md:order-1">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{t('orderSummary')}</h2>

          {mixed ? (
            <div role="alert" className="mt-4 rounded-2xl border border-red-700/20 bg-red-50 p-5 text-sm text-red-900" data-testid="cart-mixed">
              <p>{t('cartMixed')}</p>
              <ul className="mt-3 space-y-2">
                {lines.map((l) => (
                  <li key={`${l.ticketId}__${l.visitDate}`} className="flex items-center justify-between gap-3">
                    <span>
                      {l.qty}× {l.label} {l.visitDate ? `· ${l.visitDate}` : ''}
                    </span>
                    <button type="button" onClick={() => removeLine(l.ticketId, l.visitDate)} className="text-xs font-semibold underline">
                      {t('remove')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {quoting && !quote ? <p className="mt-4 text-sm text-ink-900/60">{t('bookChecking')}</p> : null}
          {quoteError ? (
            <div role="alert" className="mt-4 rounded-2xl border border-red-700/20 bg-red-50 p-5 text-sm text-red-900" data-testid="quote-problem">
              <p>{t(quoteError)}</p>
              <Link to="/tickets" className="mt-3 inline-block text-xs font-semibold underline">
                {t('checkoutChangeDate')}
              </Link>
            </div>
          ) : null}

          {quote ? (
            <>
              <p className="mt-4 text-sm text-ink-900/70" data-testid="quote-date">
                {t('orderVisitOn')}: <strong>{f.day(quote.visitDate)}</strong> · {f.name(quote.audience)}
              </p>
              <ul className="mt-3 divide-y divide-ink-900/10 rounded-2xl border border-ink-900/10" data-testid="quote-lines">
                {quote.lines.map((line) => (
                  <li key={line.ticketType} className="flex items-center justify-between gap-4 px-5 py-4" data-testid="quote-line">
                    <div>
                      <p className="text-sm font-medium text-ink-900">{f.name(line)}</p>
                      <p className="text-xs text-ink-900/50">
                        {t('quantity')}: {f.digits(line.quantity)} · <span dir="ltr">{money(pounds(line.unitPriceMinor))}</span>
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-ink-900" dir="ltr">
                      {money(pounds(line.lineTotalMinor))}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center justify-between rounded-2xl bg-sand-100 px-5 py-4 text-base font-semibold text-ink-900">
                <span>{t('checkoutTotal')}</span>
                <span dir="auto" data-testid="quote-total">
                  {money(pounds(quote.totalMinor))}
                </span>
              </div>
              <BookingNotes catalog={catalog} className="mt-5" />
            </>
          ) : null}
        </Reveal>

        <Reveal delay={0.1} className="order-1 md:order-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{t('contactDetails')}</h2>
          <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-5" noValidate>
            <Field name="fullName" autoComplete="name" label={t('fullName')} type="text" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} error={problems.fullName ? t('checkoutNameInvalid') : undefined} />
            <Field name="email" autoComplete="email" label={t('email')} type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} error={problems.email ? t('checkoutEmailInvalid') : undefined} />
            <Field name="phone" autoComplete="tel" label={t('phone')} type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} error={problems.phone ? t('checkoutPhoneInvalid') : undefined} />

            <div>
              <label className="flex items-start gap-3 text-sm leading-relaxed text-ink-900/80">
                <input
                  type="checkbox"
                  name="acceptTerms"
                  checked={form.accepted}
                  onChange={(e) => setForm({ ...form, accepted: e.target.checked })}
                  aria-invalid={problems.accepted ? true : undefined}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-ink-900/30 accent-teal-700"
                />
                <span>{t('checkoutTerms')}</span>
              </label>
              {problems.accepted ? <p className="mt-1.5 text-xs text-red-800">{t('checkoutTermsRequired')}</p> : null}
            </div>

            <p className="rounded-xl border border-gold-500/30 bg-gold-100/40 px-4 py-3 text-xs leading-relaxed text-ink-900/70">{t('checkoutKeepLink')}</p>

            {submitError ? (
              <p role="alert" data-testid="submit-problem" className="rounded-xl border border-red-700/20 bg-red-50 px-4 py-3 text-sm text-red-900">
                {t(submitError)}
              </p>
            ) : null}

            <Button type="submit" className="w-full justify-center" disabled={!quote || placing || mixed}>
              {placing ? t('checkoutPlacing') : t('checkoutPlace')}
            </Button>
          </form>
        </Reveal>
      </div>
    </Container>
  )
}
