import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, Notice, PageHeader, Select, Spinner, TextInput } from '../components/ui'
import { api, errorMessage, type PageMeta } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/hooks'
import { scanLabel, type GateRow, type ScanRow } from '../lib/operations'
import { formatMoment } from '../lib/ticketing'

/**
 * What happened at the gates: who was let in, who was refused and why. With scans:read it is everyone's scans; with
 * only scans:read_own, your own. The scanned code itself is never kept or shown.
 */
export function ScansPage() {
  const { can } = useAuth()
  const all = can('scans:read')
  const [outcome, setOutcome] = useState<'' | 'granted' | 'denied'>('')
  const [gateId, setGateId] = useState('')
  const [date, setDate] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<ScanRow[] | null>(null)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const gates = useLoad<GateRow[]>(can('gates:read') ? '/gates' : null)

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
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (outcome) params.set('outcome', outcome)
      if (gateId) params.set('gateId', gateId)
      if (date) params.set('date', date)
      if (debounced.trim()) params.set('search', debounced.trim())
      const r = await api.getPage<ScanRow>(`/scans?${params.toString()}`)
      setRows(r.items)
      setMeta(r.meta)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [outcome, gateId, date, debounced, page])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = outcome || gateId || date || debounced
  return (
    <div className="space-y-6">
      <PageHeader title="Scans" description={all ? 'Every ticket scan at the gates, newest first.' : 'Your own ticket scans, newest first.'} />
      <Card>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <TextInput label="Search" placeholder="Ticket number" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select label="Result" value={outcome} onChange={(e) => { setOutcome(e.target.value as '' | 'granted' | 'denied'); setPage(1) }}>
            <option value="">All</option>
            <option value="granted">Let in</option>
            <option value="denied">Refused</option>
          </Select>
          {gates.data && (
            <Select label="Gate" value={gateId} onChange={(e) => { setGateId(e.target.value); setPage(1) }}>
              <option value="">All gates</option>
              {gates.data.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameEn}
                </option>
              ))}
            </Select>
          )}
          <TextInput label="Day" type="date" value={date} onChange={(e) => { setDate(e.target.value); setPage(1) }} hint="The park's own calendar day (Cairo)." />
        </div>
        {filtered && (
          <button className="mt-3 text-sm font-medium text-teal-800 hover:underline" onClick={() => { setOutcome(''); setGateId(''); setDate(''); setSearch(''); setPage(1) }}>
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
          <p className="text-sm text-stone-500">{filtered ? 'No scans match these filters.' : 'No scans yet.'}</p>
        </Card>
      )}
      {rows && rows.length > 0 && (
        <Card>
          <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[40rem] text-left text-sm" data-testid="scans-table">
              <thead className="text-xs uppercase text-stone-500">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Result</th>
                  <th className="py-2 pr-3">Ticket</th>
                  <th className="py-2 pr-3">Gate</th>
                  {all && <th className="py-2">Staff</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((s) => (
                  <tr key={s.id} data-testid="scan-row">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatMoment(s.scannedAt)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={s.granted ? 'teal' : 'red'}>{scanLabel(s.result)}</Badge>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{s.ticketRef ?? '—'}</td>
                    <td className="py-2 pr-3">{s.gate?.nameEn ?? '—'}</td>
                    {all && <td className="py-2">{s.staff}</td>}
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
                Page {meta.page} of {meta.totalPages} · {meta.total} scans
              </span>
              <Button variant="ghost" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
                Next →
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
