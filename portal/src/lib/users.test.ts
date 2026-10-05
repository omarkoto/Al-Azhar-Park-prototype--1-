import { describe, expect, it } from 'vitest'
import { canManage, formatLastLogin, grantable, permissionsOfRoles, statusOf, usersQuery, type RoleInfo } from './users'

const roles: RoleInfo[] = [
  { id: '1', code: 'SUPER_ADMIN', name: 'Super', permissions: ['users:read', 'users:write', 'roles:write'] },
  { id: '2', code: 'ADMIN', name: 'Admin', permissions: ['users:read', 'users:write'] },
  { id: '3', code: 'ANALYST', name: 'Analyst', permissions: ['users:read'] },
]
const adminMe = { id: 'me', permissions: ['users:read', 'users:write'] }

describe('user helpers', () => {
  it('works out status', () => {
    expect(statusOf({ isActive: true, isLocked: false })).toBe('active')
    expect(statusOf({ isActive: true, isLocked: true })).toBe('locked')
    expect(statusOf({ isActive: false, isLocked: true })).toBe('inactive') // deactivated wins
  })

  it('unions permissions across roles', () => {
    expect([...permissionsOfRoles(['ADMIN', 'ANALYST'], roles)].sort()).toEqual(['users:read', 'users:write'])
    expect(permissionsOfRoles([], roles).size).toBe(0)
  })

  it('offers only roles you could grant', () => {
    expect(roles.filter((r) => grantable(r, adminMe.permissions)).map((r) => r.code)).toEqual(['ADMIN', 'ANALYST'])
  })

  it('says whether you can manage someone: not yourself, not someone above you', () => {
    const analyst = { id: 'a', roles: [{ code: 'ANALYST', name: 'Analyst' }] }
    const boss = { id: 'b', roles: [{ code: 'SUPER_ADMIN', name: 'Super' }] }
    expect(canManage(analyst, adminMe, roles)).toBe(true)
    expect(canManage(boss, adminMe, roles)).toBe(false)
    expect(canManage({ id: 'me', roles: [] }, adminMe, roles)).toBe(false)
    expect(canManage(boss, { id: 'x', permissions: ['users:read', 'users:write', 'roles:write'] }, roles)).toBe(true)
  })

  it('formats last sign-in', () => {
    const now = new Date('2026-10-05T12:00:00Z')
    expect(formatLastLogin(null, now)).toBe('Never')
    expect(formatLastLogin('2026-10-05T11:59:40Z', now)).toBe('Just now')
    expect(formatLastLogin('2026-10-05T11:15:00Z', now)).toBe('45 min ago')
    expect(formatLastLogin('2026-10-05T07:00:00Z', now)).toBe('5 h ago')
    expect(formatLastLogin('2026-10-03T12:00:00Z', now)).toBe('2 days ago')
  })

  it('builds the list query, leaving out empty filters', () => {
    expect(usersQuery({ search: '', role: '', status: '', page: 1 })).toBe('/users?page=1&limit=20')
    expect(usersQuery({ search: ' ann ', role: 'ADMIN', status: 'false', page: 3 })).toBe('/users?page=3&limit=20&search=ann&role=ADMIN&isActive=false')
  })
})
