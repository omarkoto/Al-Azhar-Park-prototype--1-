import type { MediaItem } from './restaurants'

export const JOURNAL_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const
export type JournalStatus = (typeof JOURNAL_STATUSES)[number]

export const JOURNAL_STATUS_LABEL: Record<JournalStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
}

export const JOURNAL_STATUS_HELP: Record<JournalStatus, string> = {
  DRAFT: 'Only visible in this portal.',
  PUBLISHED: 'Shown on the website’s Journal, with its own page.',
  ARCHIVED: 'Hidden from the public. It can be restored as a draft.',
}

/** The same table as the server's. A hint for which buttons to show; the server decides what is allowed. */
export const JOURNAL_TRANSITIONS: Record<JournalStatus, JournalStatus[]> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
}

export interface JournalStatusAction {
  to: JournalStatus
  label: string
  /** needs a confirmation: it hides a public article */
  confirm?: string
  tone: 'primary' | 'secondary' | 'danger'
}

/** The buttons for an article's status panel, in the order they should appear. */
export function journalStatusActions(from: JournalStatus): JournalStatusAction[] {
  const labels: Record<JournalStatus, (f: JournalStatus) => Omit<JournalStatusAction, 'to'>> = {
    PUBLISHED: () => ({ label: 'Publish', tone: 'primary' }),
    DRAFT: (f) => (f === 'ARCHIVED' ? { label: 'Restore as draft', tone: 'secondary' } : { label: 'Move back to draft', tone: 'secondary', confirm: 'Hide this article from the website and make it a draft?' }),
    ARCHIVED: () => ({ label: 'Archive', tone: 'secondary', confirm: 'Archive this article? It disappears from the website.' }),
  }
  const order: JournalStatus[] = ['PUBLISHED', 'DRAFT', 'ARCHIVED']
  return order.filter((to) => JOURNAL_TRANSITIONS[from].includes(to)).map((to) => ({ to, ...labels[to](from) }))
}

export interface JournalData {
  id: string
  slug: string
  status: JournalStatus
  titleEn: string
  titleAr: string
  tagEn: string
  tagAr: string
  shortDescriptionEn: string
  shortDescriptionAr: string
  bodyEn: string
  bodyAr: string
  dateLabelEn: string | null
  dateLabelAr: string | null
  isFeatured: boolean
  cover: MediaItem | null
  gallery: Array<{ media: MediaItem; captionEn: string | null; captionAr: string | null }>
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface JournalForm {
  slug: string
  titleEn: string
  titleAr: string
  tagEn: string
  tagAr: string
  shortDescriptionEn: string
  shortDescriptionAr: string
  bodyEn: string
  bodyAr: string
  dateLabelEn: string
  dateLabelAr: string
  isFeatured: boolean
}

/** The limits the server enforces, so the form can show how much room is left (the server does the real checking). */
export const JOURNAL_LIMITS = { title: 150, tag: 40, short: 300, body: 20000, dateLabel: 60 } as const

export const emptyJournalForm = (): JournalForm => ({
  slug: '', titleEn: '', titleAr: '', tagEn: '', tagAr: '', shortDescriptionEn: '', shortDescriptionAr: '', bodyEn: '', bodyAr: '', dateLabelEn: '', dateLabelAr: '', isFeatured: false,
})

export function journalToForm(a: JournalData): JournalForm {
  return {
    slug: a.slug, titleEn: a.titleEn, titleAr: a.titleAr, tagEn: a.tagEn, tagAr: a.tagAr, shortDescriptionEn: a.shortDescriptionEn, shortDescriptionAr: a.shortDescriptionAr,
    bodyEn: a.bodyEn, bodyAr: a.bodyAr, dateLabelEn: a.dateLabelEn ?? '', dateLabelAr: a.dateLabelAr ?? '', isFeatured: a.isFeatured,
  }
}

const blank = (v: string) => v.trim() || null

/** The body for POST/PUT /journal. The cover is kept as it is (it is changed in the Photos tab). */
export function formToJournal(f: JournalForm, coverMediaId: string | null, includeSlug: boolean) {
  return {
    ...(includeSlug ? { slug: f.slug.trim() } : {}),
    titleEn: f.titleEn.trim(), titleAr: f.titleAr.trim(), tagEn: f.tagEn.trim(), tagAr: f.tagAr.trim(),
    shortDescriptionEn: f.shortDescriptionEn.trim(), shortDescriptionAr: f.shortDescriptionAr.trim(), bodyEn: f.bodyEn.trim(), bodyAr: f.bodyAr.trim(),
    dateLabelEn: blank(f.dateLabelEn), dateLabelAr: blank(f.dateLabelAr), isFeatured: f.isFeatured, coverMediaId,
  }
}

/** "120 / 300", turning into a warning text once the limit is passed. */
export function counter(value: string, max: number): { text: string; over: boolean } {
  const n = value.trim().length
  return { text: `${n} / ${max}`, over: n > max }
}

/** How many paragraphs the article has (a blank line starts a new one), for the hint under the text box. */
export function paragraphCount(body: string): number {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0).length
}

/** What is worth fixing before publishing (warnings, never a block), for the status panel. */
export function publishWarnings(a: Pick<JournalData, 'cover' | 'titleEn' | 'titleAr' | 'tagEn' | 'tagAr' | 'shortDescriptionEn' | 'shortDescriptionAr' | 'bodyEn' | 'bodyAr'>): string[] {
  const problems: string[] = []
  if (!a.cover) problems.push('There is no cover photo yet: the website will show a neutral picture on the card.')
  if (a.bodyEn.trim().length < 200 || a.bodyAr.trim().length < 200) problems.push('The article text is very short in at least one language.')
  return problems
}
