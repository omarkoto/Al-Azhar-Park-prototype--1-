import type { ReactNode } from 'react'
import { barsOf, labelEvery, niceMax, pointsOf, ticksOf } from '../lib/analytics'
import { Card } from './ui'

export interface ChartSeries {
  name: string
  values: number[]
  /** a Tailwind-independent colour so the chart prints and works in any theme */
  color: string
}

export interface TableColumn {
  header: string
  align?: 'left' | 'right'
}

const W = 640
const H = 220
const PAD = { left: 52, right: 12, top: 12, bottom: 36 }

/**
 * A chart and, always, the same numbers as a table. The picture has a title and a text summary for screen readers; the table
 * is a real <table> inside a disclosure so it is reachable by keyboard and in the page for assistive technology.
 */
export function ChartCard({
  title,
  description,
  labels,
  series,
  kind = 'bar',
  unit,
  format,
  axisFormat,
  stacked = false,
  actions,
  emptyText = 'Nothing to show for this period.',
}: {
  title: string
  description?: string
  labels: string[]
  series: ChartSeries[]
  kind?: 'bar' | 'line'
  unit: string
  format: (n: number) => string
  /** a shorter form for the axis (thousands, no decimals) */
  axisFormat?: (n: number) => string
  stacked?: boolean
  actions?: ReactNode
  emptyText?: string
}) {
  const total = (i: number) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0)
  const top = niceMax(stacked ? Math.max(0, ...labels.map((_, i) => total(i))) : Math.max(0, ...series.flatMap((s) => s.values)))
  const empty = labels.length === 0 || series.every((s) => s.values.every((v) => v === 0))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const every = labelEvery(labels.length)
  const summary = `${title}. ${unit}. ${labels.length} points${empty ? ', all zero' : `, highest ${format(Math.max(...series.flatMap((s) => s.values)))}`}.`
  const slot = labels.length > 0 ? plotW / labels.length : plotW
  const rows = labels.map((label, i) => [label, ...series.map((s) => format(s.values[i] ?? 0))])
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return (
    <Card title={title} description={description} actions={actions}>
      <figure data-testid={`chart-${slug}`}>
        {empty ? (
          <p className="rounded-lg bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">{emptyText}</p>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="h-auto w-full" data-testid="chart-svg">
            <title>{summary}</title>
            <g transform={`translate(${PAD.left} ${PAD.top})`}>
              {ticksOf(top).map((t) => {
                const y = plotH - (t / top) * plotH
                return (
                  <g key={t}>
                    <line x1={0} x2={plotW} y1={y} y2={y} stroke="#e7e5e4" strokeWidth={1} />
                    <text x={-8} y={y + 4} textAnchor="end" fontSize={11} fill="#78716c">
                      {(axisFormat ?? format)(t)}
                    </text>
                  </g>
                )
              })}
              {kind === 'bar' &&
                series.map((s, si) => {
                  const heights = stacked ? labels.map((_, i) => series.slice(0, si + 1).reduce((n, x) => n + (x.values[i] ?? 0), 0)) : s.values
                  const bars = barsOf(heights, top, plotW, plotH, 0.25)
                  const below = stacked && si > 0 ? barsOf(labels.map((_, i) => series.slice(0, si).reduce((n, x) => n + (x.values[i] ?? 0), 0)), top, plotW, plotH, 0.25) : null
                  const share = stacked ? 1 : 1 / series.length
                  return bars.map((b, i) => {
                    const w = b.width * share
                    const x = b.x + (stacked ? 0 : b.width * share * si)
                    const h = below ? b.height - below[i].height : b.height
                    return <rect key={`${si}-${i}`} x={x} y={b.y} width={w} height={Math.max(0, h)} fill={s.color} rx={2} />
                  })
                })}
              {kind === 'line' &&
                series.map((s, si) => {
                  const pts = pointsOf(s.values, top, plotW, plotH)
                  return (
                    <g key={si}>
                      <polyline fill="none" stroke={s.color} strokeWidth={2} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
                      {pts.length <= 40 && pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill={s.color} />)}
                    </g>
                  )
                })}
              {labels.map((l, i) =>
                i % every === 0 ? (
                  <text key={i} x={i * slot + slot / 2} y={plotH + 18} textAnchor="middle" fontSize={11} fill="#78716c">
                    {l}
                  </text>
                ) : null,
              )}
            </g>
          </svg>
        )}
        {series.length > 1 && !empty && (
          <ul className="mt-2 flex flex-wrap gap-4 text-xs text-stone-600" aria-label="Legend">
            {series.map((s) => (
              <li key={s.name} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
                {s.name}
              </li>
            ))}
          </ul>
        )}
        <figcaption className="sr-only">{summary}</figcaption>
      </figure>
      <details className="mt-3 text-sm" data-testid={`table-${slug}`}>
        <summary className="cursor-pointer font-medium text-teal-800">View as a table</summary>
        <DataTable columns={[{ header: 'Period' }, ...series.map((s) => ({ header: `${s.name} (${unit})`, align: 'right' as const }))]} rows={rows} caption={`${title}: the same figures as the chart`} totals={series.length > 0 ? ['Total', ...series.map((s) => format(s.values.reduce((a, b) => a + b, 0)))] : undefined} />
      </details>
    </Card>
  )
}

/** A plain accessible table with right-aligned numbers and an optional totals row. */
export function DataTable({ columns, rows, caption, totals, testId }: { columns: TableColumn[]; rows: Array<Array<ReactNode>>; caption?: string; totals?: ReactNode[]; testId?: string }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[22rem] text-left text-sm" data-testid={testId}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="text-xs uppercase text-stone-500">
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={`py-2 pr-3 ${c.align === 'right' ? 'text-right' : ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-sand-100">
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((cell, ci) => (
                <td key={ci} className={`py-1.5 pr-3 ${columns[ci]?.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot className="border-t border-stone-300 font-semibold">
            <tr>
              {totals.map((cell, ci) => (
                <td key={ci} className={`py-1.5 pr-3 ${columns[ci]?.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** One headline number with its label and an optional note (a definition, or what it does not include). */
export function Stat({ label, value, note, testId }: { label: string; value: string; note?: string; testId?: string }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-4 shadow-sm" data-testid={testId}>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-stone-900" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-stone-500">{note}</p>}
    </div>
  )
}

/** Horizontal bars for shares of a whole (type, audience, gate, result), with the numbers beside them. Pairs with a table. */
export function ShareBars({ title, description, items, unit, format }: { title: string; description?: string; items: Array<{ label: string; value: number; share: number | null }>; unit: string; format: (n: number) => string }) {
  const max = Math.max(0, ...items.map((i) => i.value))
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return (
    <Card title={title} description={description}>
      {items.length === 0 || max === 0 ? (
        <p className="rounded-lg bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">Nothing to show for this period.</p>
      ) : (
        <ul className="space-y-2" data-testid={`bars-${slug}`} aria-label={`${title}, ${unit}`}>
          {items.map((i) => (
            <li key={i.label} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate" title={i.label}>
                {i.label}
              </span>
              <span className="h-3 rounded-full bg-stone-100" aria-hidden="true">
                <span className="block h-3 rounded-full bg-teal-600" style={{ width: `${(i.value / max) * 100}%` }} />
              </span>
              <span className="tabular-nums text-stone-700">
                {format(i.value)}
                {i.share !== null && <span className="ml-1 text-xs text-stone-500">({i.share}%)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-teal-800">View as a table</summary>
        <DataTable
          columns={[{ header: 'Group' }, { header: unit, align: 'right' }, { header: 'Share', align: 'right' }]}
          rows={items.map((i) => [i.label, format(i.value), i.share === null ? '—' : `${i.share}%`])}
          caption={`${title}: the same figures as the bars`}
          testId={`table-${slug}-data`}
        />
      </details>
    </Card>
  )
}
