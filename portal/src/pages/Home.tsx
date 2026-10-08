import { Link } from 'react-router-dom'
import { Badge, Card, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'

const SHORTCUTS = [
  { to: '/park', title: 'Park information', body: 'Name, tagline, description and the statistics shown on the website.', permission: 'park:read' },
  { to: '/contact', title: 'Contact details', body: 'Address, phones, e-mail, map link and social links.', permission: 'contact:read' },
  { to: '/hours', title: 'Opening hours', body: 'Weekly hours, holidays, Ramadan and temporary closures.', permission: 'hours:read' },
  { to: '/restaurants', title: 'Restaurants', body: 'Restaurant details, hours, photos and menus.', permission: 'restaurants:read' },
  { to: '/events', title: 'Events', body: 'Events and what is coming soon: dates, venues, photos and status.', permission: 'events:read' },
  { to: '/venues', title: 'Venues', body: 'The places in the park where events happen.', permission: 'venues:read' },
  { to: '/scanner', title: 'Gate scanner', body: 'Scan the tickets of arriving visitors at the entrance: access granted or the reason it is refused.', permission: 'scans:create' },
  { to: '/orders', title: 'Orders', body: 'Search ticket orders, see payments and tickets, cancel for an operational reason.', permission: 'orders:read' },
  { to: '/ticket-types', title: 'Ticket types', body: 'Adult, child and any other ticket the park sells, by age.', permission: 'ticket-types:read' },
  { to: '/prices', title: 'Ticket prices', body: 'What each ticket costs on weekdays and weekends, and price changes from a future date.', permission: 'pricing:read' },
  { to: '/media', title: 'Media library', body: 'Upload and manage photos and PDF files.', permission: 'media:read' },
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
