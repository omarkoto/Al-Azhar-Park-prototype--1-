/**
 * Permissions are `resource:action`. Guards check these, never role names (Phase 2), so a new role is just
 * data: pick permissions in the portal. Roles below are the initial, editable defaults.
 */
export const PERMISSIONS: ReadonlyArray<readonly [code: string, description: string]> = [
  ['users:read', 'View portal users'],
  ['users:write', 'Create, edit and deactivate portal users'],
  ['roles:read', 'View roles and permissions'],
  ['roles:write', 'Create and edit roles, assign permissions'],
  ['permissions:read', 'View the permission catalogue'],

  ['park:read', 'View park information'],
  ['park:write', 'Edit park information and statistics'],
  ['hours:read', 'View opening hours'],
  ['hours:write', 'Edit opening hours, holidays and closures'],
  ['contact:read', 'View contact information'],
  ['contact:write', 'Edit contact information'],

  ['restaurants:read', 'View restaurants'],
  ['restaurants:write', 'Create and edit restaurants'],
  ['menus:read', 'View restaurant menus'],
  ['menus:write', 'Create and edit restaurant menus'],

  ['events:read', 'View events'],
  ['events:write', 'Create and edit events, their photos and their order'],
  ['events:publish', "Change an event's status: coming soon, published, cancelled, archived, restored"],

  ['venues:read', 'View event venues'],
  ['venues:write', 'Create and edit event venues, switch them on or off'],

  ['media:read', 'View uploaded media'],
  ['media:write', 'Upload and delete media'],

  ['ticket-types:read', 'View ticket types and the current price list'],
  ['pricing:read', 'View price history and price rules'],
  ['pricing:write', 'Create and change ticket prices'],

  ['customers:read', 'View customer details'],
  ['customers:privacy', 'Handle customer data access, anonymisation and deletion requests'],

  ['orders:read', 'View all orders'],
  ['orders:cancel', 'Cancel orders'],
  ['payments:read', 'View payments'],
  ['payments:record_cash', 'Record a manual (cash) payment on an existing order'],
  ['counter-sales:create', 'Sell tickets at the booth: create an order, take cash, issue tickets'],

  ['tickets:read', 'View all ticket details'],
  ['tickets:read_entry', 'View only the ticket fields needed at the gate'],
  ['tickets:cancel', 'Cancel tickets for an operational reason (not a refund — the park does not refund)'],
  ['tickets:resend', 'Re-send tickets to a customer'],

  ['scans:create', 'Scan and validate tickets at the entrance'],
  ['scans:read', 'View the full scan history'],
  ['scans:read_own', 'View only your own scans'],
  ['gates:read', 'View gates'],
  ['gates:write', 'Manage gates'],

  ['analytics:read', 'View all analytics'],
  ['analytics:operations', 'View operational analytics (entry, scans, visitors)'],
  ['analytics:content', 'View content statistics'],

  ['audit:read', 'Search the audit log'],
  ['settings:read', 'View system settings'],
  ['settings:write', 'Change system settings'],
  ['notifications:read', 'View the notification outbox'],
];

export interface RoleSeed {
  code: string;
  name: string;
  description: string;
  /** '*' = every permission that exists, now and in future seeds */
  permissions: '*' | readonly string[];
}

export const ROLES: readonly RoleSeed[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super administrator',
    description: 'Full access to everything, including roles, settings and administrators.',
    permissions: '*',
  },
  {
    code: 'ADMIN',
    name: 'Administrator',
    description: 'Manages content, tickets, pricing, events, restaurants and users; views analytics, orders and tickets.',
    permissions: [
      'users:read', 'users:write', 'roles:read', 'permissions:read',
      'park:read', 'park:write', 'hours:read', 'hours:write', 'contact:read', 'contact:write',
      'restaurants:read', 'restaurants:write', 'menus:read', 'menus:write',
      'events:read', 'events:write', 'events:publish', 'venues:read', 'venues:write', 'media:read', 'media:write',
      'ticket-types:read', 'pricing:read', 'pricing:write',
      'customers:read', 'customers:privacy',
      'orders:read', 'orders:cancel', 'payments:read', 'payments:record_cash', 'counter-sales:create',
      'tickets:read', 'tickets:cancel', 'tickets:resend',
      'tickets:read_entry', 'scans:create', 'scans:read', 'scans:read_own', 'gates:read', 'gates:write',
      'analytics:read', 'analytics:operations', 'analytics:content', 'audit:read', 'settings:read', 'notifications:read',
    ],
  },
  {
    code: 'OPERATIONS',
    name: 'Operations',
    description: 'Operational information, orders and tickets, scanning and operational analytics. No system or admin settings.',
    permissions: [
      'park:read', 'hours:read', 'hours:write', 'contact:read', 'contact:write',
      'restaurants:read', 'menus:read', 'events:read', 'events:write', 'venues:read', 'media:read',
      'ticket-types:read',
      'customers:read',
      'orders:read', 'orders:cancel', 'payments:read', 'payments:record_cash', 'counter-sales:create',
      'tickets:read', 'tickets:cancel', 'tickets:resend',
      'scans:create', 'scans:read', 'gates:read',
      'analytics:operations',
    ],
  },
  {
    code: 'TICKET_STAFF',
    name: 'Ticket staff',
    description: 'Scans tickets at the gate and sells tickets at the booth. No prices, content, users or settings.',
    permissions: [
      'scans:create', 'scans:read_own', 'tickets:read_entry', 'gates:read',
      'ticket-types:read', 'counter-sales:create',
    ],
  },
  {
    code: 'CONTENT_MANAGER',
    name: 'Content manager',
    description: 'Website content: park information, opening hours, contact, events, restaurants and menus.',
    permissions: [
      'park:read', 'park:write', 'hours:read', 'hours:write', 'contact:read', 'contact:write',
      'restaurants:read', 'restaurants:write', 'menus:read', 'menus:write',
      'events:read', 'events:write', 'events:publish', 'venues:read', 'venues:write', 'media:read', 'media:write',
      'analytics:content',
    ],
  },
  {
    code: 'ANALYST',
    name: 'Analyst',
    description: 'Read-only analytics, orders and tickets. No modification permissions.',
    permissions: [
      'analytics:read', 'orders:read', 'payments:read', 'tickets:read', 'scans:read',
      'ticket-types:read', 'pricing:read', 'events:read', 'venues:read', 'restaurants:read', 'park:read',
    ],
  },
];

export const DEV_USERS: ReadonlyArray<{ email: string; fullName: string; role: string }> = [
  { email: 'superadmin@azharpark.test', fullName: 'Dev Super Admin', role: 'SUPER_ADMIN' },
  { email: 'admin@azharpark.test', fullName: 'Dev Admin', role: 'ADMIN' },
  { email: 'operations@azharpark.test', fullName: 'Dev Operations', role: 'OPERATIONS' },
  { email: 'staff@azharpark.test', fullName: 'Dev Ticket Staff', role: 'TICKET_STAFF' },
  { email: 'content@azharpark.test', fullName: 'Dev Content Manager', role: 'CONTENT_MANAGER' },
  { email: 'analyst@azharpark.test', fullName: 'Dev Analyst', role: 'ANALYST' },
];
