import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Checkbox, Modal, Notice, PageHeader, Spinner, TextArea, TextInput, useToast } from '../components/ui'
import { api, errorMessage, fieldErrors } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/hooks'
import { diffPermissions, groupPermissions, sameSet, toggleGroup, type PermissionInfo } from '../lib/permissions'

interface Role {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  permissions: string[]
  userCount: number
}

export function RolesPage() {
  const { can, profile } = useAuth()
  const roles = useLoad<Role[]>('/roles')
  const catalogue = useLoad<PermissionInfo[]>(can('permissions:read') ? '/permissions' : null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const canWrite = can('roles:write')

  const selected = roles.data?.find((r) => r.id === selectedId) ?? roles.data?.[0] ?? null

  if (roles.loading && !roles.data) return <Spinner />
  if (roles.error && !roles.data) return <Notice tone="error">{roles.error}</Notice>

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & permissions"
        description="A role is a named set of permissions. People get access only through their roles. Changes apply to everyone holding the role on their very next click."
      />
      {!canWrite && <Notice tone="info">You can view roles but only a super administrator can change them.</Notice>}

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <Card
          title="Roles"
          actions={
            canWrite && (
              <Button variant="secondary" onClick={() => setCreating(true)}>
                New role
              </Button>
            )
          }
        >
          <ul className="space-y-1">
            {roles.data?.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setSelectedId(r.id)}
                  aria-current={selected?.id === r.id}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${selected?.id === r.id ? 'bg-teal-50 text-teal-900' : 'hover:bg-stone-50'}`}
                >
                  <span className="block font-medium">{r.name}</span>
                  <span className="block text-xs text-stone-500">
                    {r.code} · {r.userCount} user{r.userCount === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {selected && catalogue.data ? (
          <RoleEditor key={selected.id} role={selected} catalogue={catalogue.data} canWrite={canWrite} ownRoles={profile?.roles ?? []} onChanged={roles.reload} onDeleted={() => setSelectedId(null)} />
        ) : catalogue.loading ? (
          <Spinner />
        ) : (
          <Notice tone="warn">{catalogue.error ?? 'The permission list is not available to you.'}</Notice>
        )}
      </div>

      {creating && catalogue.data && (
        <CreateRole
          catalogue={catalogue.data}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false)
            await roles.reload()
            setSelectedId(id)
          }}
        />
      )}
    </div>
  )
}

function RoleEditor({ role, catalogue, canWrite, ownRoles, onChanged, onDeleted }: { role: Role; catalogue: PermissionInfo[]; canWrite: boolean; ownRoles: string[]; onChanged: () => Promise<void>; onDeleted: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions))
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<'details' | 'permissions' | 'delete' | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setName(role.name)
    setDescription(role.description ?? '')
    setSelected(new Set(role.permissions))
  }, [role])

  const groups = useMemo(() => groupPermissions(catalogue), [catalogue])
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? groups.map((g) => ({ ...g, items: g.items.filter((i) => i.code.includes(q) || i.description.toLowerCase().includes(q)) })).filter((g) => g.items.length > 0) : groups
  }, [groups, filter])

  const diff = diffPermissions(role.permissions, [...selected])
  const dirtyPermissions = !sameSet(role.permissions, [...selected])
  const dirtyDetails = name !== role.name || description !== (role.description ?? '')
  const editingOwnRole = ownRoles.includes(role.code)

  async function saveDetails() {
    setBusy('details')
    setErrors({})
    try {
      await api.patch(`/roles/${role.id}`, { name: name.trim(), description: description.trim() || null })
      toast('success', 'Role details saved.')
      await onChanged()
    } catch (err) {
      setErrors(fieldErrors(err))
      toast('error', errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function savePermissions() {
    setBusy('permissions')
    try {
      await api.put(`/roles/${role.id}/permissions`, { permissionCodes: [...selected] })
      toast('success', `Permissions saved: ${diff.added.length} added, ${diff.removed.length} removed.`)
      await onChanged()
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the role “${role.name}”?`)) return
    setBusy('delete')
    try {
      await api.delete(`/roles/${role.id}`)
      toast('success', 'Role deleted.')
      onDeleted()
      await onChanged()
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card
        title={role.name}
        description={`Code ${role.code} · ${role.userCount} user${role.userCount === 1 ? '' : 's'}${role.isSystem ? ' · built-in role' : ''}`}
        actions={role.isSystem ? <Badge tone="teal">Built-in</Badge> : null}
      >
        <fieldset disabled={!canWrite || busy !== null} className="grid gap-4 md:grid-cols-2">
          <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={60} />
          <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} maxLength={300} />
        </fieldset>
        {canWrite && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void saveDetails()} busy={busy === 'details'} disabled={!dirtyDetails || !name.trim()}>
              Save details
            </Button>
            {!role.isSystem && (
              <Button variant="danger" onClick={() => void remove()} busy={busy === 'delete'} disabled={role.userCount > 0} title={role.userCount > 0 ? 'Reassign its users first' : undefined}>
                Delete role
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card title="Permissions" description={`${selected.size} of ${catalogue.length} selected. The list comes from the server.`}>
        {editingOwnRole && canWrite && <div className="mb-4"><Notice tone="warn">You hold this role. Removing permissions here also removes them from you.</Notice></div>}
        <div className="mb-4">
          <input aria-label="Filter permissions" placeholder="Filter permissions…" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-teal-700" />
        </div>
        <div className="space-y-5">
          {visible.map((g) => {
            const all = g.items.every((i) => selected.has(i.code))
            return (
              <fieldset key={g.resource} disabled={!canWrite || busy !== null} className="rounded-lg border border-sand-200 p-3">
                <legend className="px-1">
                  <Checkbox label={<span className="font-semibold capitalize">{g.resource.replace(/-/g, ' ')}</span>} checked={all} onChange={(v) => setSelected(toggleGroup(selected, g, v))} />
                </legend>
                <div className="mt-1 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {g.items.map((i) => (
                    <Checkbox
                      key={i.code}
                      checked={selected.has(i.code)}
                      onChange={(v) => {
                        const next = new Set(selected)
                        if (v) next.add(i.code)
                        else next.delete(i.code)
                        setSelected(next)
                      }}
                      label={
                        <span>
                          <span className="font-mono text-xs">{i.code}</span>
                          {i.description && <span className="block text-xs text-stone-500">{i.description}</span>}
                        </span>
                      }
                    />
                  ))}
                </div>
              </fieldset>
            )
          })}
          {visible.length === 0 && <p className="text-sm text-stone-500">No permission matches “{filter}”.</p>}
        </div>
        {canWrite && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={() => void savePermissions()} busy={busy === 'permissions'} disabled={!dirtyPermissions}>
              Save permissions
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set(role.permissions))} disabled={!dirtyPermissions}>
              Discard changes
            </Button>
            {dirtyPermissions && (
              <span className="text-xs text-amber-700">
                {diff.added.length} to add, {diff.removed.length} to remove
              </span>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function CreateRole({ catalogue, onClose, onCreated }: { catalogue: PermissionInfo[]; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const toast = useToast()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    setErrors({})
    setFormError(null)
    try {
      const created = await api.post<Role>('/roles', { code: code.trim().toUpperCase().replace(/\s+/g, '_'), name: name.trim(), description: description.trim() || null, permissionCodes: [] })
      toast('success', 'Role created. Now choose its permissions.')
      await onCreated(created.id)
    } catch (err) {
      const fe = fieldErrors(err)
      setErrors(fe)
      setFormError(Object.keys(fe).length === 0 ? errorMessage(err) : null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="New role" onClose={onClose}>
      <div className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={60} placeholder="Event coordinator" />
        <TextInput label="Code" value={code} onChange={(e) => setCode(e.target.value)} error={errors.code} hint="Capital letters and underscores, e.g. EVENT_COORDINATOR. It cannot be changed later." placeholder="EVENT_COORDINATOR" />
        <TextArea label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} maxLength={300} />
        <p className="text-xs text-stone-500">The role starts with no permissions (of {catalogue.length} available). You choose them next.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void create()} busy={busy} disabled={!name.trim() || !code.trim()}>
            Create role
          </Button>
        </div>
      </div>
    </Modal>
  )
}
