import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, Modal, Notice, PageHeader, Select, Spinner, TextArea, TextInput, useToast } from '../components/ui'
import { api, errorMessage, type PageMeta } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/hooks'
import {
  canCancelOrder, formatDay, formatMoment, money, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, ORDER_STATUSES, PAYMENT_STATUS_LABEL, reasonProblem, type OrderDetail, type OrderRow, type OrderStatus,
} from '../lib/ticketing'

/** Orders: search, filter, see every detail, and cancel for an operational reason (this is never a refund). */
export function OrdersPage() {
  const [status, setStatus] = useState<'' | OrderStatus>('')
  const [visitDate, setVisitDate] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<OrderRow[] | null>(null)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const { can } = useAuth()

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(search)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (status) params.set('status', status)
      if (visitDate) params.set('visitDate', visitDate)
      if (debounced.trim()) params.set('search', debounced.trim())
      const r = await api.getPage<OrderRow>(`/orders?${params.toString()}`)
      setRows(r.items)
      setMeta(r.meta)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [status, visitDate, debounced, page])

  useEffect(() => {
    void load()
  }, [load])

  const showCustomer = can('customers:read')
  return (
    <div className="space-y-6">
      <PageHeader title="Orders" description="Every ticket order, online and at the booth. Open an order to see its tickets, payment and customer. Cancelling an order is an operational decision, not a refund: the park does not refund." />
      <Card>
        <div className="grid gap-3 md:grid-cols-[1fr_12rem_11rem] md:items-end">
          <TextInput label="Search" placeholder={showCustomer ? 'Order number, name, e-mail or phone' : 'Order number'} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value as '' | OrderStatus); setPage(1) }}>
            <option value="">All</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <TextInput label="Visit date" type="date" value={visitDate} onChange={(e) => { setVisitDate(e.target.value); setPage(1) }} />
        </div>
      </Card>
      {!rows && !error && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      {rows && rows.length === 0 && <Card><p className="text-sm text-stone-500">No orders match.</p></Card>}
      {rows && rows.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm" data-testid="orders-table">
              <thead className="text-xs uppercase text-stone-500">
                <tr>
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Visit date</th>
                  <th className="py-2 pr-3">Tickets</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3">Status</th>
                  {showCustomer && <th className="py-2 pr-3">Customer</th>}
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((o) => (
                  <tr key={o.id} data-testid="order-row">
                    <td className="py-2 pr-3 font-medium text-stone-900">
                      {o.orderNumber}
                      <div className="text-xs font-normal text-stone-500">{formatMoment(o.createdAt)}</div>
                    </td>
                    <td className="py-2 pr-3">{formatDay(o.visitDate)}</td>
                    <td className="py-2 pr-3">{o.ticketCount}</td>
                    <td className="py-2 pr-3">{money(o.totalMinor, o.currency)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                    </td>
                    {showCustomer && <td className="py-2 pr-3">{o.customer?.fullName ?? '—'}</td>}
                    <td className="py-2 text-right">
                      <Button variant="ghost" onClick={() => setOpenId(o.id)} aria-label={`Open order ${o.orderNumber}`}>
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
                Page {meta.page} of {meta.totalPages} · {meta.total} orders
              </span>
              <Button variant="ghost" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
                Next →
              </Button>
            </div>
          )}
        </Card>
      )}
      {openId && (
        <OrderModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={async () => {
            await load()
          }}
        />
      )}
    </div>
  )
}

function OrderModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const { can } = useAuth()
  const toast = useToast()
  const { data: o, error, reload } = useLoad<OrderDetail>(`/orders/${id}`)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function cancel() {
    const problem = reasonProblem(reason)
    setReasonError(problem)
    if (problem) return
    setBusy(true)
    try {
      await api.post(`/orders/${id}/cancel`, { reason: reason.trim() })
      toast('success', 'Order cancelled.')
      setCancelling(false)
      setReason('')
      await reload()
      await onChanged()
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={o ? `Order ${o.orderNumber}` : 'Order'} onClose={onClose}>
      {!o && !error && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      {o && (
        <div className="space-y-5" data-testid="order-detail">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
            <Badge>{o.channel === 'ONLINE' ? 'Online' : 'Booth sale'}</Badge>
            <span className="text-sm text-stone-600">Visit date: <strong>{formatDay(o.visitDate)}</strong></span>
          </div>

          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-stone-500">
              <tr>
                <th className="py-1 pr-3">Ticket</th>
                <th className="py-1 pr-3">Price each</th>
                <th className="py-1 pr-3">Qty</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {o.items.map((i) => (
                <tr key={i.id}>
                  <td className="py-1.5 pr-3">
                    {i.typeNameEn}
                    <div className="text-xs text-stone-500">{i.audienceNameEn}</div>
                  </td>
                  <td className="py-1.5 pr-3">{money(i.unitPriceMinor, o.currency)}</td>
                  <td className="py-1.5 pr-3">{i.quantity}</td>
                  <td className="py-1.5 text-right">{money(i.lineTotalMinor, o.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-2 text-right font-medium">Total</td>
                <td className="pt-2 text-right font-semibold" data-testid="order-total">{money(o.totalMinor, o.currency)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="text-xs text-stone-500">Prices are the ones the customer paid on the day of the order; they never change afterwards.</p>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-stone-500">Created</dt><dd>{formatMoment(o.createdAt)}</dd></div>
            {o.status === 'PENDING_PAYMENT' && <div><dt className="text-xs text-stone-500">Held until</dt><dd>{formatMoment(o.expiresAt)}</dd></div>}
            {o.paidAt && <div><dt className="text-xs text-stone-500">Paid</dt><dd>{formatMoment(o.paidAt)}</dd></div>}
            <div><dt className="text-xs text-stone-500">Tickets</dt><dd>{Object.entries(o.ticketCounts).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ') || '—'}</dd></div>
          </dl>

          {o.customer && (
            <div className="rounded-lg bg-stone-50 p-3 text-sm">
              <p className="text-xs text-stone-500">Customer</p>
              <p className="font-medium text-stone-900">{o.customer.fullName}</p>
              <p className="text-stone-600">{o.customer.email ?? '—'} · {o.customer.phone ?? 'no phone'}</p>
            </div>
          )}

          {o.payments && (
            <div>
              <p className="mb-1 text-xs uppercase text-stone-500">Payments</p>
              {o.payments.length === 0 ? <p className="text-sm text-stone-500">None.</p> : (
                <ul className="divide-y divide-stone-100 text-sm">
                  {o.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span>{p.provider} · {p.method.toLowerCase()}</span>
                      <span>{money(p.amountMinor, p.currency)} · {PAYMENT_STATUS_LABEL[p.status]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {o.tickets && o.tickets.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm text-teal-800">{o.tickets.length} ticket{o.tickets.length === 1 ? '' : 's'}</summary>
              <ul className="mt-2 divide-y divide-stone-100 text-sm">
                {o.tickets.map((t) => (
                  <li key={t.ref} className="flex justify-between gap-2 py-1">
                    <span className="font-mono text-xs">{t.ref}</span>
                    <span>{t.typeNameEn} · {t.status.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {o.status === 'CANCELLED' && (
            <Notice tone="warn">
              Cancelled {formatMoment(o.cancelledAt)}{o.cancelledBy ? ` by ${o.cancelledBy}` : ''}. Reason: {o.cancelReason}
              <br />
              This is not a refund; nothing was paid back through the system.
            </Notice>
          )}

          {can('orders:cancel') && canCancelOrder(o.status) && !cancelling && (
            <div className="flex justify-end">
              <Button variant="danger" onClick={() => setCancelling(true)}>
                Cancel this order
              </Button>
            </div>
          )}
          {cancelling && (
            <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-900">
                This cancels the order and every ticket in it; they stop working. <strong>It is not a refund</strong>: nothing is paid back through the system. The reason, your name and the time are recorded.
              </p>
              <TextArea label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} error={reasonError ?? undefined} maxLength={500} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => { setCancelling(false); setReasonError(null) }}>
                  Keep the order
                </Button>
                <Button variant="danger" busy={busy} onClick={() => void cancel()}>
                  Confirm cancellation
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
