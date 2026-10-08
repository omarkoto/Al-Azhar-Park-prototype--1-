export interface NavItem {
  to: string
  label: string
  /** shown when the person holds ANY of these permissions (the page and the server check again) */
  anyOf: string[]
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

/**
 * The portal's menu, in the order people use it. What is shown is a convenience only: every page and every action is
 * checked again by the server against the person's permissions. A group with nothing the person may open is not shown.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Operations',
    items: [
      { to: '/orders', label: 'Orders', anyOf: ['orders:read'] },
      { to: '/tickets', label: 'Tickets', anyOf: ['tickets:read'] },
      { to: '/scanner', label: 'Gate scanner', anyOf: ['scans:create'] },
      { to: '/scans', label: 'Scans', anyOf: ['scans:read', 'scans:read_own'] },
      { to: '/gates', label: 'Gates', anyOf: ['gates:read'] },
    ],
  },
  {
    title: 'Park & content',
    items: [
      { to: '/park', label: 'Park information', anyOf: ['park:read'] },
      { to: '/contact', label: 'Contact details', anyOf: ['contact:read'] },
      { to: '/hours', label: 'Opening hours', anyOf: ['hours:read'] },
      { to: '/events', label: 'Events', anyOf: ['events:read'] },
      { to: '/venues', label: 'Venues', anyOf: ['venues:read'] },
      { to: '/restaurants', label: 'Restaurants', anyOf: ['restaurants:read'] },
      { to: '/media', label: 'Media library', anyOf: ['media:read'] },
    ],
  },
  {
    title: 'Tickets & pricing',
    items: [
      { to: '/ticket-types', label: 'Ticket types', anyOf: ['ticket-types:read'] },
      { to: '/prices', label: 'Ticket prices', anyOf: ['pricing:read'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/users', label: 'Staff accounts', anyOf: ['users:read'] },
      { to: '/roles', label: 'Roles & permissions', anyOf: ['roles:read'] },
    ],
  },
]

/** The menu for one person: only the items they hold a permission for, and no empty groups. */
export function visibleNav(can: (permission: string) => boolean): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.anyOf.some(can)) })).filter((g) => g.items.length > 0)
}
