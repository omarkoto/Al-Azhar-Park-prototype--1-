import { useState } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Spinner } from './ui'

const NAV: Array<{ to: string; label: string; permission: string }> = [
  { to: '/park', label: 'Park information', permission: 'park:read' },
  { to: '/contact', label: 'Contact details', permission: 'contact:read' },
  { to: '/hours', label: 'Opening hours', permission: 'hours:read' },
  { to: '/restaurants', label: 'Restaurants', permission: 'restaurants:read' },
  { to: '/events', label: 'Events', permission: 'events:read' },
  { to: '/venues', label: 'Venues', permission: 'venues:read' },
  { to: '/media', label: 'Media library', permission: 'media:read' },
  { to: '/users', label: 'Staff accounts', permission: 'users:read' },
  { to: '/roles', label: 'Roles & permissions', permission: 'roles:read' },
]

/** Everything inside requires a signed-in user; the menu shows only what that user's permissions allow. */
export function Layout() {
  const { status, profile, can, logout } = useAuth()
  const [open, setOpen] = useState(false)

  if (status === 'loading') return <Spinner label="Checking your session…" />
  if (status === 'anonymous' || !profile) return <Navigate to="/login" replace />

  const items = NAV.filter((n) => can(n.permission))
  return (
    <div className="min-h-screen bg-stone-50 md:flex">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 md:hidden">
        <span className="font-semibold text-teal-900">Al-Azhar Park · Portal</span>
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu" className="rounded border border-stone-300 px-3 py-1 text-sm">
          Menu
        </button>
      </header>

      <aside className={`${open ? 'block' : 'hidden'} w-full shrink-0 border-r border-stone-200 bg-white md:flex md:min-h-screen md:w-64 md:flex-col`}>
        <div className="hidden px-5 py-5 md:block">
          <p className="text-lg font-semibold text-teal-900">Al-Azhar Park</p>
          <p className="text-xs tracking-wide text-stone-500 uppercase">Staff portal</p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Main">
          <NavLink to="/" end onClick={() => setOpen(false)} className={linkClass}>
            Home
          </NavLink>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)} className={linkClass}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-stone-200 px-5 py-4 text-sm">
          <p className="truncate font-medium text-stone-900">{profile.fullName}</p>
          <p className="truncate text-xs text-stone-500">{profile.email}</p>
          <button onClick={() => void logout()} className="mt-3 text-sm font-medium text-teal-800 hover:underline">
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
        <div className="mx-auto max-w-4xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-teal-50 text-teal-900' : 'text-stone-600 hover:bg-stone-100'}`

/** Wraps a page so someone without the permission sees a clear message (the server refuses them anyway). */
export function RequirePermission({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { can } = useAuth()
  if (!can(permission)) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        You do not have access to this page. Ask an administrator if you need it.
      </div>
    )
  }
  return <>{children}</>
}
