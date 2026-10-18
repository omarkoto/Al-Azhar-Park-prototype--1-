import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, Checkbox, Modal, Notice, PageHeader, Select, Spinner, TextInput, useToast } from '../components/ui'
import { api, errorMessage, fieldErrors } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/hooks'
import { canManage, formatLastLogin, grantable, STATUS_LABEL, statusOf, usersQuery, type RoleInfo, type UserRow } from '../lib/users'

interface Page {
  items: UserRow[]
  meta: { page: number; totalPages: number; total: number }
}

const statusTone = { active: 'teal', inactive: 'neutral', locked: 'amber' } as const

export function UsersPage() {
  const { can, profile } = useAuth()
  const roles = useLoad<RoleInfo[]>(can('roles:read') ? '/roles' : null)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState<'' | 'true' | 'false'>('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<UserRow | null>(null)
  const [inviting, setInviting] = useState(false)
  const canWrite = can('users:write')

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
      const path = usersQuery({ search: debounced, role, status, page })
      const items = await api.get<UserRow[]>(path)
      // the envelope's meta is not returned by the shared client, so page by "a full page means there may be more"
      setData({ items, meta: { page, totalPages: items.length === 20 ? page + 1 : page, total: items.length } })
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [debounced, role, status, page])

  useEffect(() => {
    void load()
  }, [load])

  const roleList = roles.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader title="Staff accounts" description="People who sign in to this portal. Access comes from roles; the server checks every action against the permissions of those roles." />

      <Card
        actions={
          canWrite && (
            <Button onClick={() => setInviting(true)} disabled={roleList.length === 0}>
              Add account
            </Button>
          )
        }
      >
        <div className="grid gap-3 md:grid-cols-[1fr_12rem_10rem]">
          <TextInput label="Search" placeholder="Name or e-mail" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }} disabled={roleList.length === 0}>
            <option value="">All roles</option>
            {roleList.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </Select>
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value as '' | 'true' | 'false'); setPage(1) }}>
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Deactivated</option>
          </Select>
        </div>

        <div className="mt-5">
          {loading && !data && <Spinner />}
          {error && <Notice tone="error">{error}</Notice>}
          {data && data.items.length === 0 && <p className="py-6 text-sm text-stone-500">No one matches these filters.</p>}
          {data && data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs tracking-wide text-stone-500 uppercase">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Person</th>
                    <th className="py-2 pr-3 font-semibold">Roles</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 font-semibold">Last sign-in</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-100">
                  {data.items.map((u) => (
                    <tr key={u.id} data-testid="user-row">
                      <td className="py-3 pr-3">
                        <p className="font-medium text-stone-900">
                          {u.fullName} {u.id === profile?.id && <span className="text-xs text-stone-400">(you)</span>}
                        </p>
                        <p className="text-xs text-stone-500">{u.email}</p>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r) => (
                            <Badge key={r.code} tone="teal">
                              {r.name}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <Badge tone={statusTone[statusOf(u)]}>{STATUS_LABEL[statusOf(u)]}</Badge>
                      </td>
                      <td className="py-3 pr-3 text-stone-600">{formatLastLogin(u.lastLoginAt)}</td>
                      <td className="py-3 text-right">
                        <Button variant="secondary" onClick={() => setSelected(u)} aria-label={`Open ${u.fullName}`}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && (page > 1 || data.meta.totalPages > page) && (
            <div className="mt-4 flex items-center justify-between text-sm text-stone-600">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ← Previous
              </Button>
              <span>Page {page}</span>
              <Button variant="ghost" disabled={data.meta.totalPages <= page} onClick={() => setPage(page + 1)}>
                Next →
              </Button>
            </div>
          )}
        </div>
      </Card>

      {inviting && (
        <InviteUser
          roles={roleList}
          onClose={() => setInviting(false)}
          onCreated={async () => {
            setInviting(false)
            await load()
          }}
        />
      )}
      {selected && (
        <UserDetail
          user={selected}
          roles={roleList}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            await load()
            const fresh = await api.get<UserRow>(`/users/${selected.id}`)
            setSelected(fresh)
          }}
        />
      )}
    </div>
  )
}

// ───────────────────────────── invite ─────────────────────────────

function InviteUser({ roles, onClose, onCreated }: { roles: RoleInfo[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setErrors({})
    setFormError(null)
    try {
      await api.post('/users', { email: email.trim(), fullName: fullName.trim(), roleCodes: chosen, ...(password ? { password } : {}) })
      toast('success', password ? `Account created for ${email.trim()}.` : `Invitation sent to ${email.trim()}.`)
      await onCreated()
    } catch (err) {
      const fe = fieldErrors(err)
      setErrors(fe)
      setFormError(Object.keys(fe).length === 0 ? errorMessage(err) : null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add an account" onClose={onClose}>
      <div className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <p className="text-sm text-stone-500">Set a password they can sign in with now, or leave it empty to send them a one-time link to choose their own.</p>
        <TextInput label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} error={errors.fullName} />
        <TextInput label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <TextInput label="Password (optional)" type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="At least 12 characters; not common, and not containing their name or e-mail. Share it with them securely." />
        <RolePicker roles={roles} chosen={chosen} onChange={setChosen} myPermissions={profile?.permissions ?? []} error={errors.roleCodes} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} busy={busy} disabled={!email.trim() || fullName.trim().length < 2 || chosen.length === 0}>
            {password ? 'Create account' : 'Send invitation'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function RolePicker({ roles, chosen, onChange, myPermissions, error, disabled }: { roles: RoleInfo[]; chosen: string[]; onChange: (codes: string[]) => void; myPermissions: readonly string[]; error?: string; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">Roles</legend>
      <div className="space-y-2">
        {roles.map((r) => {
          const ok = grantable(r, myPermissions)
          return (
            <div key={r.code}>
              <Checkbox
                label={
                  <span>
                    {r.name} <span className="text-xs text-stone-400">{r.code}</span>
                    {!ok && <span className="block text-xs text-amber-700">You cannot grant this role: it has permissions you do not have.</span>}
                  </span>
                }
                checked={chosen.includes(r.code)}
                disabled={!ok && !chosen.includes(r.code)}
                onChange={(v) => onChange(v ? [...chosen, r.code] : chosen.filter((c) => c !== r.code))}
              />
            </div>
          )
        })}
      </div>
      {error && <p className="mt-1 text-xs font-medium text-red-700">{error}</p>}
    </fieldset>
  )
}

// ───────────────────────────── detail ─────────────────────────────

function UserDetail({ user, roles, canWrite, onClose, onChanged }: { user: UserRow; roles: RoleInfo[]; canWrite: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [fullName, setFullName] = useState(user.fullName)
  const [chosen, setChosen] = useState<string[]>(user.roles.map((r) => r.code))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFullName(user.fullName)
    setChosen(user.roles.map((r) => r.code))
  }, [user])

  const manageable = !!profile && canWrite && canManage(user, profile, roles)
  const isSelf = user.id === profile?.id
  const rolesChanged = [...chosen].sort().join() !== user.roles.map((r) => r.code).sort().join()
  const st = statusOf(user)

  async function run(key: string, fn: () => Promise<unknown>, success: string) {
    setBusy(key)
    setError(null)
    try {
      await fn()
      toast('success', success)
      await onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title={user.fullName} onClose={onClose}>
      <div className="space-y-6">
        {error && <Notice tone="error">{error}</Notice>}
        {isSelf && <Notice tone="info">This is your own account. You cannot change your own roles or deactivate yourself.</Notice>}
        {!isSelf && canWrite && !manageable && <Notice tone="warn">This person has more access than you, so you can view them but not change them.</Notice>}

        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-stone-500 uppercase">E-mail</dt>
            <dd className="mt-1 break-all text-stone-900">{user.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Status</dt>
            <dd className="mt-1">
              <Badge tone={statusTone[st]}>{STATUS_LABEL[st]}</Badge>
              {st === 'locked' && <span className="ml-2 text-xs text-stone-500">Too many wrong passwords; sending a password reset clears it.</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Last sign-in</dt>
            <dd className="mt-1 text-stone-900">{formatLastLogin(user.lastLoginAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Account created</dt>
            <dd className="mt-1 text-stone-900">{new Date(user.createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>

        {manageable && (
          <>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <TextInput label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <Button variant="secondary" disabled={fullName.trim() === user.fullName || fullName.trim().length < 2} busy={busy === 'name'} onClick={() => void run('name', () => api.patch(`/users/${user.id}`, { fullName: fullName.trim() }), 'Name saved.')}>
                Save name
              </Button>
            </div>

            <div>
              <RolePicker roles={roles} chosen={chosen} onChange={setChosen} myPermissions={profile?.permissions ?? []} disabled={busy !== null} />
              <Button className="mt-3" disabled={!rolesChanged || chosen.length === 0} busy={busy === 'roles'} onClick={() => void run('roles', () => api.put(`/users/${user.id}/roles`, { roleCodes: chosen }), 'Roles saved. They have been signed out and will get the new access when they sign in again.')}>
                Save roles
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-sand-200 pt-4">
              <Button variant="secondary" busy={busy === 'reset'} disabled={!user.isActive} onClick={() => void run('reset', () => api.post(`/users/${user.id}/send-password-reset`), 'Password reset link sent.')}>
                Send password reset
              </Button>
              {user.isActive ? (
                <Button variant="danger" busy={busy === 'deactivate'} onClick={() => window.confirm(`Deactivate ${user.fullName}? They are signed out everywhere immediately.`) && void run('deactivate', () => api.post(`/users/${user.id}/deactivate`), 'Account deactivated.')}>
                  Deactivate
                </Button>
              ) : (
                <Button busy={busy === 'activate'} onClick={() => void run('activate', () => api.post(`/users/${user.id}/activate`), 'Account activated.')}>
                  Activate
                </Button>
              )}
            </div>
          </>
        )}
        {!manageable && (
          <div className="flex flex-wrap gap-1">
            {user.roles.map((r) => (
              <Badge key={r.code} tone="teal">
                {r.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
