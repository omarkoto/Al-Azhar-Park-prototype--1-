import { useState } from 'react'
import { Badge, Button, Card, Modal, Notice, PageHeader, Spinner, TextInput, useToast } from '../components/ui'
import { api, errorMessage, fieldErrors } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/hooks'
import { deactivationWarning, gateProblems, type GateForm, type GateRow } from '../lib/operations'
import { formatMoment } from '../lib/ticketing'

/** The entrances. A gate is switched off, never deleted, so the scans made at it keep their record. */
export function GatesPage() {
  const { can } = useAuth()
  const toast = useToast()
  const { data, loading, error, reload } = useLoad<GateRow[]>('/gates')
  const [editing, setEditing] = useState<GateRow | 'new' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const canWrite = can('gates:write')
  const activeCount = data?.filter((g) => g.isActive).length ?? 0

  async function toggle(g: GateRow) {
    if (g.isActive && !window.confirm(deactivationWarning(g, activeCount))) return
    setBusyId(g.id)
    try {
      await api.put(`/gates/${g.id}/active`, { isActive: !g.isActive })
      toast('success', g.isActive ? `${g.nameEn} switched off.` : `${g.nameEn} switched on.`)
      await reload()
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Gates" description="The entrances where tickets are scanned. Any staff member who may scan can use any active gate. A switched-off gate cannot be chosen for new scans; what was scanned there stays on record." />
      {canWrite && (
        <div>
          <Button onClick={() => setEditing('new')}>Add a gate</Button>
        </div>
      )}
      {loading && !data && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      {data && activeCount === 0 && <Notice tone="warn">No gate is switched on, so nobody can scan tickets right now.</Notice>}
      <Card>
        {data && data.length === 0 && <p className="text-sm text-stone-500">No gates yet.</p>}
        <ul className="divide-y divide-stone-100" data-testid="gate-list">
          {data?.map((g) => (
            <li key={g.id} data-testid="gate-row" data-active={g.isActive ? 'true' : 'false'} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-900">
                  {g.nameEn} <span dir="rtl" className="text-stone-500">· {g.nameAr}</span>
                </p>
                <p className="text-xs text-stone-500">
                  Code {g.code}
                  {g.usage ? ` · ${g.usage.entriesToday} let in and ${g.usage.deniedToday} refused today · ${g.usage.totalScans} scans in all${g.usage.lastScanAt ? ` · last ${formatMoment(g.usage.lastScanAt)}` : ''}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Badge tone={g.isActive ? 'teal' : 'neutral'}>{g.isActive ? 'Active' : 'Switched off'}</Badge>
                {canWrite && (
                  <>
                    <Button variant="ghost" onClick={() => setEditing(g)} aria-label={`Edit ${g.nameEn}`}>
                      Edit
                    </Button>
                    <Button variant="ghost" className={g.isActive ? 'text-red-700' : ''} busy={busyId === g.id} onClick={() => void toggle(g)} aria-label={`${g.isActive ? 'Switch off' : 'Switch on'} ${g.nameEn}`}>
                      {g.isActive ? 'Switch off' : 'Switch on'}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {editing && (
        <GateModal
          gate={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await reload()
          }}
        />
      )}
    </div>
  )
}

function GateModal({ gate, onClose, onSaved }: { gate: GateRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [f, setF] = useState<GateForm>(gate ? { code: gate.code, nameEn: gate.nameEn, nameAr: gate.nameAr } : { code: '', nameEn: '', nameAr: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    const local = gateProblems(f, !gate)
    setErrors(local as Record<string, string>)
    if (Object.keys(local).length > 0) return
    setBusy(true)
    setFormError(null)
    try {
      if (gate) await api.put(`/gates/${gate.id}`, { nameEn: f.nameEn.trim(), nameAr: f.nameAr.trim() })
      else await api.post('/gates', { code: f.code.trim().toUpperCase(), nameEn: f.nameEn.trim(), nameAr: f.nameAr.trim() })
      toast('success', 'Gate saved.')
      await onSaved()
    } catch (err) {
      const fe = fieldErrors(err)
      setErrors(fe)
      setFormError(Object.keys(fe).length === 0 ? errorMessage(err) : null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={gate ? `Edit ${gate.nameEn}` : 'Add a gate'} onClose={onClose}>
      <div className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Name (English)" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} error={errors.nameEn} />
          <TextInput label="Name (Arabic)" rtl value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} error={errors.nameAr} />
          <TextInput label="Code" value={f.code} disabled={!!gate} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} error={errors.code} hint={gate ? 'Cannot be changed.' : 'Capital letters, digits and underscores, e.g. NORTH.'} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} busy={busy}>
            Save gate
          </Button>
        </div>
      </div>
    </Modal>
  )
}
