import { useState } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { visibleNav } from '../lib/navigation'
import { Spinner } from './ui'

/** Everything inside requires a signed-in user; the menu shows only what that user's permissions allow. */
export function Layout() {
  const { status, profile, can, logout } = useAuth()
  const [open, setOpen] = useState(false)

  if (status === 'loading') return <Spinner label="Checking your session…" />
  if (status === 'anonymous' || !profile) return <Navigate to="/login" replace />

  const groups = visibleNav(can)
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
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Main">
          <NavLink to="/" end onClick={() => setOpen(false)} className={linkClass}>
            Dashboard
          </NavLink>
          {groups.map((g) => (
            <div key={g.title} className="pt-3" role="group" aria-label={g.title}>
              <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-stone-400 uppercase">{g.title}</p>
              <div className="space-y-1">
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/analytics'} onClick={() => setOpen(false)} className={linkClass}>
                    {n.label}
                  </NavLink>
                ))}
              </div>
            </div>
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
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-teal-50 text-teal-900' : 'text-stone-600 hover:bg-stone-100'}`

/** The same, for a page that two permissions both open (for example all scans, or only your own). */
export function RequireAnyPermission({ permissions, children }: { permissions: string[]; children: React.ReactNode }) {
  const { can } = useAuth()
  if (!permissions.some(can)) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        You do not have access to this page. Ask an administrator if you need it.
      </div>
    )
  }
  return <>{children}</>
}

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
