import { useCallback, useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMoney } from '../lib/alt'
import {
  BookingError, completeMockPayment, downloadTicketsPdf, fetchOrder, formatCountdown, loadOrderToken, payAgain, pounds, problemKey, saveOrderToken, secondsLeft, tokenFromHash, type PublicOrder,
} from '../lib/booking'
import { useBookingFormat } from '../lib/bookingFormat'
import { cairoIso } from '../lib/calendar'
import { useSeo } from '../lib/seo'
import { Container } from '../components/ui/Container'
import { Reveal } from '../components/ui/Reveal'
import { Button, ButtonLink } from '../components/ui/Button'
import { AddToCalendar } from '../components/AddToCalendar'

const POLL_MS = 4000

/**
 * The customer's own order page, opened with the private key they were given. It shows the order exactly as the
 * server holds it: waiting for payment (with a countdown), paid (the tickets), expired or cancelled.
 */
export function OrderStatus() {
  const { orderNumber = '' } = useParams()
  const location = useLocation()
  const { t } = useTranslation()
  const money = useMoney()
  const f = useBookingFormat()
  useSeo({ title: t('orderTitle'), description: t('orderTitle'), path: `/orders/${orderNumber}` })

  const [token] = useState(() => loadOrderToken(orderNumber, location.hash))
  const [order, setOrder] = useState<PublicOrder | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [downloading, setDownloading] = useState<string | null>(null)

  // keep the private key in this browser, so the page still opens without the "#k=…" part of the address
  useEffect(() => {
    const fromHash = tokenFromHash(location.hash)
    if (fromHash) saveOrderToken(orderNumber, fromHash)
  }, [orderNumber, location.hash])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) {
        setNotFound(true)
        return
      }
      try {
        setOrder(await fetchOrder(orderNumber, token, signal))
        setNotFound(false)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        if (e instanceof BookingError && e.status === 404) setNotFound(true)
      }
    },
    [orderNumber, token],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // while the order waits for payment: tick the countdown and look for the result
  const pending = order?.status === 'PENDING_PAYMENT'
  useEffect(() => {
    if (!pending) return
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    const poll = window.setInterval(() => void load(), POLL_MS)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(poll)
    }
  }, [pending, load])

  async function simulate(outcome: 'SUCCESS' | 'FAILURE') {
    const txn = order?.payment?.providerTxnId
    if (!txn) return
    setBusy(true)
    setProblem(null)
    try {
      await completeMockPayment(txn, outcome)
      await load()
    } catch (e) {
      setProblem(problemKey(e instanceof BookingError ? e.code : 'NETWORK'))
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function download(ref?: string) {
    if (!token || !order) return
    setDownloading(ref ?? 'all')
    setProblem(null)
    try {
      await downloadTicketsPdf(orderNumber, token, { ref, lang: f.lang })
    } catch (e) {
      setProblem(e instanceof BookingError && e.status === 409 ? 'bookErrGeneric' : problemKey(e instanceof BookingError ? e.code : 'NETWORK'))
    } finally {
      setDownloading(null)
    }
  }

  async function tryAgain() {
    if (!token) return
    setBusy(true)
    setProblem(null)
    try {
      const r = await payAgain(orderNumber, token)
      setOrder(r.order)
    } catch (e) {
      setProblem(problemKey(e instanceof BookingError ? e.code : 'NETWORK'))
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (notFound) {
    return (
      <Container className="flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
        <div data-testid="order-not-found">
          <h1 className="font-display text-2xl font-medium text-ink-900">{t('orderNotFoundTitle')}</h1>
          <p className="mx-auto mt-3 max-w-md text-base text-ink-900/60">{t('orderNotFoundBody')}</p>
          <ButtonLink to="/tickets" className="mt-8">
            {t('orderBookAgain')}
          </ButtonLink>
        </div>
      </Container>
    )
  }
  if (!order) {
    return (
      <Container className="flex min-h-[60vh] items-center justify-center py-24 text-center">
        <p className="text-sm text-ink-900/60">{t('orderLoading')}</p>
      </Container>
    )
  }

  const left = secondsLeft(order.expiresAt, now)
  const paymentFailed = order.payment?.status === 'FAILED'
  const title = { PENDING_PAYMENT: 'orderStatusPending', PAID: 'orderStatusPaid', EXPIRED: 'orderStatusExpired', CANCELLED: 'orderStatusCancelled' }[order.status]
  const tone = order.status === 'PAID' ? 'bg-teal-50 text-teal-800' : order.status === 'PENDING_PAYMENT' ? 'bg-gold-100/60 text-gold-700' : 'bg-red-50 text-red-800'
  const mark = order.status === 'PAID' ? '✓' : order.status === 'PENDING_PAYMENT' ? '…' : '✕'
  const dayText = f.day(order.visitDate)

  return (
    <Container className="py-16 md:py-24">
      <Reveal className="mx-auto max-w-2xl">
        <div className="text-center">
          <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full text-3xl ${tone}`} aria-hidden="true">
            {mark}
          </div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">
            {t('orderNumberLabel')} · <span dir="ltr" data-testid="order-number">{order.orderNumber}</span>
          </p>
          <h1 className="font-display mt-2 text-3xl font-medium text-ink-900" data-testid="order-status">
            {t(title)}
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-ink-900/70">
            {order.status === 'PENDING_PAYMENT' && t('orderPendingBody', { time: formatCountdown(left).replace(/\d/g, (d) => f.digits(Number(d))) })}
            {order.status === 'PAID' && t('orderPaidBody', { name: order.customer?.fullName ?? '', date: dayText })}
            {order.status === 'EXPIRED' && t('orderExpiredBody')}
            {order.status === 'CANCELLED' && t('orderCancelledBody')}
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-ink-900/10 bg-sand-50">
          <p className="border-b border-ink-900/10 px-5 py-3 text-sm text-ink-900/70">
            {t('orderVisitOn')}: <strong data-testid="order-visit-date">{dayText}</strong>
          </p>
          <ul className="divide-y divide-ink-900/10" data-testid="order-lines">
            {order.items.map((i, n) => (
              <li key={n} className="flex items-center justify-between gap-4 px-5 py-4" data-testid="order-line">
                <div>
                  <p className="text-sm font-medium text-ink-900">
                    {f.digits(i.quantity)}× {f.name({ nameEn: i.typeNameEn, nameAr: i.typeNameAr })}
                  </p>
                  <p className="text-xs text-ink-900/50">
                    {f.name({ nameEn: i.audienceNameEn, nameAr: i.audienceNameAr })} · <span dir="ltr">{money(pounds(i.unitPriceMinor))}</span>
                  </p>
                </div>
                <p className="text-sm font-semibold text-ink-900" dir="ltr">
                  {money(pounds(i.lineTotalMinor))}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-ink-900/10 px-5 py-4 text-base font-semibold text-ink-900">
            <span>{t('checkoutTotal')}</span>
            <span dir="auto" data-testid="order-total">
              {money(pounds(order.totalMinor))}
            </span>
          </div>
        </div>

        {pending ? (
          <div className="mt-8 space-y-4" data-testid="payment-panel">
            {paymentFailed ? <p role="alert" className="rounded-xl border border-red-700/20 bg-red-50 px-4 py-3 text-sm text-red-900">{t('payFailed')}</p> : null}
            {problem ? <p role="alert" className="rounded-xl border border-red-700/20 bg-red-50 px-4 py-3 text-sm text-red-900">{t(problem)}</p> : null}
            {paymentFailed ? (
              <Button className="w-full justify-center" onClick={() => void tryAgain()} disabled={busy} data-testid="pay-again">
                {t('payTryAgain')}
              </Button>
            ) : order.payment?.isMock && order.payment.providerTxnId ? (
              <div className="rounded-2xl border border-dashed border-gold-600/50 bg-gold-100/30 p-5" data-testid="mock-payment">
                <p className="text-sm font-semibold text-ink-900">{t('payMockTitle')}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-900/65">{t('payMockBody')}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Button onClick={() => void simulate('SUCCESS')} disabled={busy} className="justify-center" data-testid="mock-pay">
                    {t('payMockPay')}
                  </Button>
                  <Button variant="ghost" onClick={() => void simulate('FAILURE')} disabled={busy} className="justify-center border-ink-900/20 text-ink-900" data-testid="mock-fail">
                    {t('payMockFail')}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-center text-sm text-ink-900/60">{t('payOnlineSoon')}</p>
            )}
          </div>
        ) : null}

        {order.status === 'PAID' ? (
          <div className="mt-8 space-y-6">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{t('orderTickets')}</h2>
              {problem ? <p role="alert" className="mt-3 rounded-xl border border-red-700/20 bg-red-50 px-4 py-3 text-sm text-red-900">{t(problem)}</p> : null}
              <ul className="mt-3 grid gap-4 sm:grid-cols-2" data-testid="order-tickets">
                {order.tickets.map((tk, n) => (
                  <li key={tk.ref} className="overflow-hidden rounded-2xl border border-ink-900/10 bg-sand-50" data-testid="order-ticket">
                    <div className="flex items-start justify-between gap-3 border-b border-dashed border-ink-900/15 bg-teal-50/50 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-ink-900">{f.name({ nameEn: tk.typeNameEn, nameAr: tk.typeNameAr })}</p>
                        <p className="text-xs text-ink-900/55">{f.name({ nameEn: tk.audienceNameEn, nameAr: tk.audienceNameAr })} · <span dir="ltr">{money(pounds(tk.pricePaidMinor))}</span></p>
                      </div>
                      <span
                        data-testid="ticket-status"
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tk.status === 'VALID' ? 'bg-teal-700 text-sand-50' : 'bg-red-100 text-red-800'}`}
                      >
                        {t(`ticketStatus_${tk.status}`)}
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-3 px-4 py-5">
                      {tk.qr ? (
                        <>
                          <img src={tk.qr} alt={t('orderQrAlt', { ref: tk.ref })} width={180} height={180} className="h-44 w-44 rounded-lg border border-ink-900/10 bg-white p-1" data-testid="ticket-qr" />
                          <p className="text-center text-xs text-ink-900/60">{t('orderShowQr')}</p>
                        </>
                      ) : (
                        <p className="py-8 text-center text-sm text-ink-900/50" data-testid="ticket-no-qr">{t('orderNoQr')}</p>
                      )}
                      <p className="font-mono text-xs text-ink-900/70" dir="ltr" data-testid="ticket-ref">
                        {tk.ref}
                      </p>
                      <p className="text-[11px] text-ink-900/45">{f.digits(n + 1)} / {f.digits(order.tickets.length)}</p>
                      {tk.status === 'VALID' ? (
                        <Button variant="ghost" className="w-full justify-center border-ink-900/20 text-ink-900" disabled={downloading !== null} onClick={() => void download(tk.ref)} data-testid="download-ticket">
                          {downloading === tk.ref ? t('orderDownloading') : t('orderDownloadOne')}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {order.tickets.some((tk) => tk.status === 'VALID') ? (
                <Button className="mt-5 w-full justify-center sm:w-auto" disabled={downloading !== null} onClick={() => void download()} data-testid="download-all">
                  {downloading === 'all' ? t('orderDownloading') : t('orderDownloadAll')}
                </Button>
              ) : null}
              <p className="mt-3 text-xs leading-relaxed text-ink-900/60">{t('orderTicketsValid', { date: dayText })}</p>
            </div>
            <div className="rounded-2xl border border-ink-900/10 bg-sand-100 p-6">
              <AddToCalendar
                filename={`al-azhar-park-${order.visitDate}`}
                entry={{
                  title: `${t('visitReminder')} (${order.orderNumber})`,
                  location: 'Al-Azhar Park, Salah Salem Street, Cairo',
                  start: cairoIso(order.visitDate, 10 * 60),
                  end: cairoIso(order.visitDate, 17 * 60),
                }}
              />
            </div>
          </div>
        ) : null}

        {order.status === 'EXPIRED' || order.status === 'CANCELLED' ? (
          <div className="mt-8 text-center">
            <ButtonLink to="/tickets">{t('orderBookAgain')}</ButtonLink>
          </div>
        ) : null}

        <p className="mt-8 text-center text-xs text-ink-900/50">{t('bookNoRefunds')}</p>
      </Reveal>
    </Container>
  )
}
