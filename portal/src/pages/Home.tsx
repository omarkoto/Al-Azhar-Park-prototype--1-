import { Link } from 'react-router-dom'
import { Badge, Card, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'

const SHORTCUTS = [
  { to: '/park', title: 'Park information', body: 'Name, tagline, description and the statistics shown on the website.', permission: 'park:read' },
  { to: '/contact', title: 'Contact details', body: 'Address, phones, e-mail, map link and social links.', permission: 'contact:read' },
  { to: '/hours', title: 'Opening hours', body: 'Weekly hours, holidays, Ramadan and temporary closures.', permission: 'hours:read' },
  { to: '/users', title: 'Staff accounts', body: 'Invite people, give them roles, deactivate accounts.', permission: 'users:read' },
  { to: '/roles', title: 'Roles & permissions', body: 'Who can do what in the portal.', permission: 'roles:read' },
]

export function Home() {
  const { profile, can } = useAuth()
  const links = SHORTCUTS.filter((s) => can(s.permission))
  return (
    <>
      <PageHeader title={`Welcome, ${profile?.fullName.split(' ')[0] ?? ''}`} description="Changes you save here appear on the public website within about a minute." />
      <Card title="Your access">
        <div className="flex flex-wrap items-center gap-2 text-sm text-stone-600">
          Roles:
          {profile?.roles.map((r) => (
            <Badge key={r} tone="teal">
              {r}
            </Badge>
          ))}
          <span className="ml-2 text-stone-400">{profile?.permissions.length ?? 0} permissions</span>
        </div>
      </Card>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {links.map((s) => (
          <Link key={s.to} to={s.to} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition-colors hover:border-teal-700">
            <h2 className="font-semibold text-stone-900">{s.title}</h2>
            <p className="mt-1 text-sm text-stone-500">{s.body}</p>
          </Link>
        ))}
        {links.length === 0 && <p className="text-sm text-stone-500">Your account has no portal sections yet. Ask an administrator for access.</p>}
      </div>
    </>
  )
}
