export const JOURNAL_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type JournalStatusValue = (typeof JOURNAL_STATUSES)[number];

/** The only status a visitor can ever see. Drafts and archived articles are portal-only. */
export const PUBLIC_JOURNAL_STATUSES = ['PUBLISHED'] as const satisfies readonly JournalStatusValue[];

/**
 * The lifecycle. Every change of status goes through this table (and needs the publish permission):
 *  - DRAFT → published, or archived;
 *  - PUBLISHED → back to draft, or archived;
 *  - ARCHIVED → back to draft (a restored article is a draft first, never straight to the public).
 */
export const JOURNAL_TRANSITIONS: Record<JournalStatusValue, readonly JournalStatusValue[]> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

export const canTransitionJournal = (from: JournalStatusValue, to: JournalStatusValue): boolean => JOURNAL_TRANSITIONS[from].includes(to);

/** The audit event name for a status change, in words an auditor can search for. */
export function journalAuditActionFor(from: JournalStatusValue, to: JournalStatusValue): string {
  switch (to) {
    case 'PUBLISHED':
      return 'journal.published';
    case 'ARCHIVED':
      return 'journal.archived';
    case 'DRAFT':
      return from === 'ARCHIVED' ? 'journal.restored' : 'journal.unpublished';
  }
}
