import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, Modal, Notice, PageHeader, Select, Spinner, TextInput, useToast } from '../components/ui'
import { api, errorMessage, type PageMeta } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/hooks'
import { scanLabel, TICKET_STATUSES, TICKET_STATUS_LABEL, TICKET_STATUS_TONE, type TicketDetail, type TicketRow, type TicketStatus } from '../lib/operations'
import { formatDay, formatMoment, money, type AudienceRow, type TicketTypeRow } from '../lib/ticketing'

/** Every ticket, searchable. Read only: a ticket changes only through payment, cancellation and the gate. */
export function TicketsPage() {
  const { can } = useAuth()
  const [status, setStatus] = useState<'' | TicketStatus>('')
  const [visitDate, setVisitDate] = useState('')
  const [ticketType, setTicketType] = useState('')
  const [audience, setAudience] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<TicketRow[] | null>(null)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  // the filter choices come from the ticket configuration; a person who may not read it simply gets no such filters
  const types = useLoad<TicketTypeRow[]>(can('ticket-types:read') ? '/ticket-types' : null)
  const audiences = useLoad<AudienceRow[]>(can('ticket-types:read') ? '/ticket-audiences' : null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(search)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (status) params.set('status', status)
      if (visitDate) params.set('visitDate', visitDate)
      if (ticketType) params.set('ticketType', ticketType)
      if (audience) params.set('audience', audience)
      if (debounced.trim()) params.set('search', debounced.trim())
      const r = await api.getPage<TicketRow>(`/tickets?${params.toString()}`)
      setRows(r.items)
      setMeta(r.meta)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [status, visitDate, ticketType, audience, debounced, page])

  useEffect(() => {
    void load()
  }, [load])

  const reset = () => {
    setStatus('')
    setVisitDate('')
    setTicketType('')
    setAudience('')
    setSearch('')
    setPage(1)
  }
  const filtered = status || visitDate || ticketType || audience || debounced

  return (
    <div className="space-y-6">
      <PageHeader title="Tickets" description="Find any ticket and see where it stands. A ticket's reference, type, date and price never change; it becomes used at the gate, or cancelled by staff. To cancel a ticket, open its order." />
      <Card>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <TextInput label="Search" placeholder="Ticket or order number" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value as '' | TicketStatus); setPage(1) }}>
            <option value="">All</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TICKET_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <TextInput label="Visit date" type="date" value={visitDate} onChange={(e) => { setVisitDate(e.target.value); setPage(1) }} />
          {types.data && (
            <Select label="Ticket type" value={ticketType} onChange={(e) => { setTicketType(e.target.value); setPage(1) }}>
              <option value="">All</option>
              {types.data.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.nameEn}
                </option>
              ))}
            </Select>
          )}
          {audiences.data && (
            <Select label="Audience" value={audience} onChange={(e) => { setAudience(e.target.value); setPage(1) }}>
              <option value="">All</option>
              {audiences.data.map((a) => (
                <option key={a.id} value={a.code}>
                  {a.nameEn}
                </option>
              ))}
            </Select>
          )}
        </div>
        {filtered && (
          <button className="mt-3 text-sm font-medium text-teal-800 hover:underline" onClick={reset}>
            Clear filters
          </button>
        )}
      </Card>

      {!rows && !error && <Spinner />}
      {error && (
        <Notice tone="error">
          {error}{' '}
          <button className="font-semibold underline" onClick={() => void load()}>
            Try again
          </button>
        </Notice>
      )}
      {rows && rows.length === 0 && (
        <Card>
          <p className="text-sm text-stone-500">{filtered ? 'No tickets match these filters.' : 'No tickets yet.'}</p>
        </Card>
      )}
      {rows && rows.length > 0 && (
        <Card>
          <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[46rem] text-left text-sm" data-testid="tickets-table">
              <thead className="text-xs uppercase text-stone-500">
                <tr>
                  <th className="py-2 pr-3">Ticket</th>
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Visit date</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Price paid</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((t) => (
                  <tr key={t.id} data-testid="ticket-row">
                    <td className="py-2 pr-3 font-mono text-xs font-medium text-stone-900">{t.ref}</td>
                    <td className="py-2 pr-3">{t.orderNumber}</td>
                    <td className="py-2 pr-3">{formatDay(t.visitDate)}</td>
                    <td className="py-2 pr-3">
                      {t.typeNameEn}
                      <div className="text-xs text-stone-500">{t.audienceNameEn}</div>
                    </td>
                    <td className="py-2 pr-3">{money(t.pricePaidMinor, t.currency)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
                    </td>
                    <td className="py-2 text-right">
                      <Button variant="ghost" onClick={() => setOpenId(t.id)} aria-label={`Open ticket ${t.ref}`}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {meta && meta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-stone-600">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ← Previous
              </Button>
              <span>
                Page {meta.page} of {meta.totalPages} · {meta.total} tickets
              </span>
              <Button variant="ghost" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
                Next →
              </Button>
            </div>
          )}
        </Card>
      )}
      {openId && <TicketModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function TicketModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const { data: t, error } = useLoad<TicketDetail>(`/tickets/${id}`)
  const [busy, setBusy] = useState(false)

  async function pdf() {
    if (!t) return
    setBusy(true)
    try {
      const blob = await api.download(`/tickets/${id}/pdf`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${t.ref}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t ? `Ticket ${t.ref}` : 'Ticket'} onClose={onClose}>
      {!t && !error && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      {t && (
        <div className="space-y-5" data-testid="ticket-detail">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
            <span className="text-sm text-stone-600">
              Valid on <strong>{formatDay(t.visitDate)}</strong> only
            </span>
          </div>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-stone-500">Ticket type</dt><dd>{t.typeNameEn} · {t.audienceNameEn}</dd></div>
            <div><dt className="text-xs text-stone-500">Price paid</dt><dd data-testid="ticket-price">{money(t.pricePaidMinor, t.currency)}</dd></div>
            <div>
              <dt className="text-xs text-stone-500">Order</dt>
              <dd>
                <Link to={`/orders?search=${encodeURIComponent(t.order.orderNumber)}`} className="text-teal-800 hover:underline">
                  {t.order.orderNumber}
                </Link>{' '}
                <span className="text-stone-500">({t.order.status.replace('_', ' ').toLowerCase()})</span>
              </dd>
            </div>
            {t.paymentStatus !== undefined && <div><dt className="text-xs text-stone-500">Payment</dt><dd>{t.paymentStatus ? t.paymentStatus.toLowerCase() : '—'}</dd></div>}
            <div><dt className="text-xs text-stone-500">Issued</dt><dd>{formatMoment(t.issuedAt)}</dd></div>
            <div><dt className="text-xs text-stone-500">QR code</dt><dd>{t.qrIssued ? 'Issued' : 'Not issued (not paid)'}</dd></div>
            {t.status === 'USED' && (
              <>
                <div><dt className="text-xs text-stone-500">Used</dt><dd data-testid="ticket-used-at">{formatMoment(t.usedAt)}</dd></div>
                {t.usedByName !== undefined && <div><dt className="text-xs text-stone-500">Let in by</dt><dd>{t.usedByName ?? '—'}</dd></div>}
              </>
            )}
          </dl>
          {t.status === 'CANCELLED' && (
            <Notice tone="warn">
              Cancelled {formatMoment(t.cancelledAt)}. Reason: {t.cancelReason}
              <br />
              This is not a refund.
            </Notice>
          )}
          {t.scans && (
            <div>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">Gate scans of this ticket</h3>
              {t.scans.length === 0 ? (
                <p className="text-sm text-stone-500">Not scanned yet.</p>
              ) : (
                <ul className="divide-y divide-stone-100 text-sm" data-testid="ticket-scans">
                  {t.scans.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span>
                        {formatMoment(s.scannedAt)} · {s.gate?.nameEn ?? '—'} · {s.staff}
                      </span>
                      <Badge tone={s.granted ? 'teal' : 'red'}>{scanLabel(s.result)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {can('tickets:resend') && (t.status === 'VALID' || t.status === 'USED') && (
            <div className="flex justify-end">
              <Button variant="secondary" busy={busy} onClick={() => void pdf()}>
                Download ticket PDF
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
