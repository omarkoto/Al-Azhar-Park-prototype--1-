import { useState } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { visibleNav } from '../lib/navigation'
import { Spinner } from './ui'
import logoMark from '../assets/logo-mark.svg'

/** Everything inside requires a signed-in user; the menu shows only what that user's permissions allow. */
export function Layout() {
  const { status, profile, can, logout } = useAuth()
  const [open, setOpen] = useState(false)

  if (status === 'loading') return <Spinner label="Checking your session…" />
  if (status === 'anonymous' || !profile) return <Navigate to="/login" replace />

  const groups = visibleNav(can)
  return (
    <div className="min-h-screen bg-sand-50 md:flex">
      <header className="flex items-center justify-between bg-teal-900 px-4 py-3 text-sand-50 md:hidden">
        <Brand />
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu" className="rounded-full border border-white/25 px-4 py-1 text-sm">
          Menu
        </button>
      </header>

      <aside className={`${open ? 'block' : 'hidden'} lattice w-full shrink-0 bg-teal-900 text-sand-50 md:sticky md:top-0 md:flex md:h-screen md:w-72 md:flex-col`}>
        <div className="hidden border-b border-white/10 px-6 py-6 md:block">
          <Brand />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-4" aria-label="Main">
          <NavLink to="/" end onClick={() => setOpen(false)} className={linkClass}>
            Dashboard
          </NavLink>
          {groups.map((g) => (
            <div key={g.title} className="pt-5" role="group" aria-label={g.title}>
              <p className="px-3 pb-2 text-[11px] font-semibold tracking-[0.18em] text-gold-500 uppercase">{g.title}</p>
              <div className="space-y-0.5">
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/analytics'} onClick={() => setOpen(false)} className={linkClass}>
                    {n.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 bg-teal-950/40 px-6 py-4 text-sm">
          <p className="truncate font-semibold">{profile.fullName}</p>
          <p className="truncate text-xs text-sand-100/60">{profile.email}</p>
          <button onClick={() => void logout()} className="mt-3 rounded-full border border-white/25 px-4 py-1 text-xs font-semibold text-sand-50 hover:bg-white/10">
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-12 md:py-10">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

/** The park's mark on a sand tile (the mark is teal, so it needs a light ground on the dark sidebar). */
export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sand-50 p-1.5 shadow-sm">
        <img src={logoMark} alt="" className="h-full w-full" />
      </span>
      <span>
        <span className="font-display block text-lg leading-tight font-semibold">Al-Azhar Park</span>
        <span className="block text-[11px] tracking-[0.18em] text-gold-500 uppercase">Staff portal</span>
      </span>
    </div>
  )
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-xl px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-sand-50 text-teal-900 shadow-sm' : 'text-sand-100/80 hover:bg-white/10 hover:text-white'}`

/** The same, for a page that two permissions both open (for example all scans, or only your own). */
export function RequireAnyPermission({ permissions, children }: { permissions: string[]; children: React.ReactNode }) {
  const { can } = useAuth()
  if (!permissions.some(can)) {
    return (
      <div className="rounded-2xl border border-gold-100 bg-gold-100/50 p-6 text-sm text-amber-900">
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
      <div className="rounded-2xl border border-gold-100 bg-gold-100/50 p-6 text-sm text-amber-900">
        You do not have access to this page. Ask an administrator if you need it.
      </div>
    )
  }
  return <>{children}</>
}
