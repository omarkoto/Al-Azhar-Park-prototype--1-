export const EVENT_STATUSES = ['DRAFT', 'COMING_SOON', 'PUBLISHED', 'CANCELLED', 'ARCHIVED'] as const;
export type EventStatusValue = (typeof EVENT_STATUSES)[number];

/** The only statuses a visitor can ever see. Everything else is portal-only. */
export const PUBLIC_STATUSES = ['COMING_SOON', 'PUBLISHED'] as const satisfies readonly EventStatusValue[];

/**
 * The lifecycle. Every change of status goes through this table (and needs the publish permission):
 *  - DRAFT → coming soon / published / archived;
 *  - COMING_SOON ↔ PUBLISHED, back to DRAFT, cancelled or archived;
 *  - CANCELLED → back to DRAFT (to re-plan it) or archived;
 *  - ARCHIVED → back to DRAFT (restore).
 * Nothing jumps from CANCELLED or ARCHIVED straight to the public: a restored event is a draft first.
 */
export const TRANSITIONS: Record<EventStatusValue, readonly EventStatusValue[]> = {
  DRAFT: ['COMING_SOON', 'PUBLISHED', 'ARCHIVED'],
  COMING_SOON: ['PUBLISHED', 'DRAFT', 'CANCELLED', 'ARCHIVED'],
  PUBLISHED: ['COMING_SOON', 'DRAFT', 'CANCELLED', 'ARCHIVED'],
  CANCELLED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

export const canTransition = (from: EventStatusValue, to: EventStatusValue): boolean => TRANSITIONS[from].includes(to);

export const isPublic = (status: EventStatusValue): boolean => (PUBLIC_STATUSES as readonly string[]).includes(status);

/** The audit event name for a status change, in words an auditor can search for. */
export function auditActionFor(from: EventStatusValue, to: EventStatusValue): string {
  switch (to) {
    case 'PUBLISHED':
      return 'event.published';
    case 'COMING_SOON':
      return 'event.coming_soon';
    case 'CANCELLED':
      return 'event.cancelled';
    case 'ARCHIVED':
      return 'event.archived';
    case 'DRAFT':
      return from === 'CANCELLED' || from === 'ARCHIVED' ? 'event.restored' : 'event.unpublished';
  }
}
