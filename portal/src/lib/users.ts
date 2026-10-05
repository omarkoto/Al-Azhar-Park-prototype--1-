export interface RoleInfo {
  id: string
  code: string
  name: string
  permissions: string[]
}

export interface UserRow {
  id: string
  email: string
  fullName: string
  isActive: boolean
  isLocked: boolean
  lastLoginAt: string | null
  createdAt: string
  roles: Array<{ code: string; name: string }>
}

export type StatusKind = 'active' | 'inactive' | 'locked'

export function statusOf(u: Pick<UserRow, 'isActive' | 'isLocked'>): StatusKind {
  return !u.isActive ? 'inactive' : u.isLocked ? 'locked' : 'active'
}

export const STATUS_LABEL: Record<StatusKind, string> = { active: 'Active', inactive: 'Deactivated', locked: 'Locked' }

/** The union of the permissions of the given role codes (roles come from the server's /roles list). */
export function permissionsOfRoles(codes: string[], roles: RoleInfo[]): Set<string> {
  const out = new Set<string>()
  for (const r of roles) if (codes.includes(r.code)) for (const p of r.permissions) out.add(p)
  return out
}

/** A role you may hand out: every permission in it is one you hold yourself (the server enforces the same rule). */
export function grantable(role: RoleInfo, myPermissions: readonly string[]): boolean {
  const mine = new Set(myPermissions)
  return role.permissions.every((p) => mine.has(p))
}

/** You may manage someone whose permissions are all ones you hold, and never yourself. UI hint only: the server decides. */
export function canManage(target: Pick<UserRow, 'id' | 'roles'>, me: { id: string; permissions: readonly string[] }, roles: RoleInfo[]): boolean {
  if (target.id === me.id) return false
  const mine = new Set(me.permissions)
  for (const p of permissionsOfRoles(target.roles.map((r) => r.code), roles)) if (!mine.has(p)) return false
  return true
}

export function formatLastLogin(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Never'
  const then = new Date(iso)
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return then.toLocaleDateString()
}

/** ?search=&role=&isActive=&page=&limit= — empty filters are left out. */
export function usersQuery(f: { search: string; role: string; status: '' | 'true' | 'false'; page: number }): string {
  const p = new URLSearchParams({ page: String(f.page), limit: '20' })
  if (f.search.trim()) p.set('search', f.search.trim())
  if (f.role) p.set('role', f.role)
  if (f.status) p.set('isActive', f.status)
  return `/users?${p.toString()}`
}
