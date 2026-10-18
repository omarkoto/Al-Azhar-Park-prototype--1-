import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, visibleNav } from './navigation'
import {
  counter, emptyJournalForm, formToJournal, JOURNAL_LIMITS, JOURNAL_STATUS_HELP, JOURNAL_STATUS_LABEL, JOURNAL_STATUSES, JOURNAL_TRANSITIONS, journalStatusActions, journalToForm, paragraphCount, publishWarnings,
  type JournalData,
} from './journal'

const article = (over: Partial<JournalData> = {}): JournalData => ({
  id: '1', slug: 'a-royal-welcome', status: 'DRAFT', titleEn: 'A royal welcome', titleAr: 'استقبال ملكي', tagEn: 'History', tagAr: 'تاريخ',
  shortDescriptionEn: 'In 2006 the park welcomed royal guests.', shortDescriptionAr: 'في عام ٢٠٠٦ استقبلت الحديقة ضيوفاً.', bodyEn: 'First.\n\nSecond.', bodyAr: 'الأولى.\n\nالثانية.',
  dateLabelEn: '2006', dateLabelAr: null, isFeatured: false, cover: null, gallery: [], publishedAt: null, createdAt: '', updatedAt: '', ...over,
})

describe('the Journal form', () => {
  it('round-trips an article through the form; blank optional wording becomes null', () => {
    const body = formToJournal(journalToForm(article()), 'cover-1', true)
    expect(body).toMatchObject({
      slug: 'a-royal-welcome', titleEn: 'A royal welcome', tagEn: 'History', tagAr: 'تاريخ', dateLabelEn: '2006', dateLabelAr: null, isFeatured: false, coverMediaId: 'cover-1',
    })
    expect(body.bodyEn).toBe('First.\n\nSecond.')
  })

  it('leaves the address out when editing a published article, and keeps the cover that is already set', () => {
    const body = formToJournal(journalToForm(article()), null, false)
    expect(body).not.toHaveProperty('slug')
    expect(body.coverMediaId).toBeNull()
  })

  it('trims every text and turns whitespace-only wording into null', () => {
    const f = { ...emptyJournalForm(), slug: ' my-story ', titleEn: '  Hello  ', tagEn: ' News ', dateLabelEn: '   ', dateLabelAr: ' ٢٠٢٦ ' }
    expect(formToJournal(f, null, true)).toMatchObject({ slug: 'my-story', titleEn: 'Hello', tagEn: 'News', dateLabelEn: null, dateLabelAr: '٢٠٢٦' })
  })

  it('starts empty and not featured', () => {
    expect(emptyJournalForm()).toEqual({ slug: '', titleEn: '', titleAr: '', tagEn: '', tagAr: '', shortDescriptionEn: '', shortDescriptionAr: '', bodyEn: '', bodyAr: '', dateLabelEn: '', dateLabelAr: '', isFeatured: false })
  })

  it('knows the limits the server enforces', () => {
    expect(JOURNAL_LIMITS).toEqual({ title: 150, tag: 40, short: 300, body: 20000, dateLabel: 60 })
  })
})

describe('the status buttons', () => {
  it('has a label and a help line for every status', () => {
    for (const s of JOURNAL_STATUSES) {
      expect(JOURNAL_STATUS_LABEL[s]).toBeTruthy()
      expect(JOURNAL_STATUS_HELP[s]).toBeTruthy()
    }
  })

  it('offers exactly the changes the server allows, and no button for the status it is already in', () => {
    for (const from of JOURNAL_STATUSES) {
      const offered = journalStatusActions(from).map((a) => a.to).sort()
      expect(offered).toEqual([...JOURNAL_TRANSITIONS[from]].sort())
      expect(offered).not.toContain(from)
    }
  })

  it('puts Publish first for a draft, and restores an archived article only as a draft', () => {
    expect(journalStatusActions('DRAFT').map((a) => a.label)).toEqual(['Publish', 'Archive'])
    expect(journalStatusActions('ARCHIVED').map((a) => [a.to, a.label])).toEqual([['DRAFT', 'Restore as draft']])
    expect(journalStatusActions('PUBLISHED').map((a) => a.label)).toEqual(['Move back to draft', 'Archive'])
  })

  it('asks for confirmation before hiding a public article, but not before publishing or restoring', () => {
    const published = journalStatusActions('PUBLISHED')
    expect(published.every((a) => !!a.confirm)).toBe(true)
    expect(journalStatusActions('DRAFT').find((a) => a.to === 'PUBLISHED')?.confirm).toBeUndefined()
    expect(journalStatusActions('ARCHIVED')[0].confirm).toBeUndefined()
  })

  it('never lets an archived article go straight to published', () => {
    expect(JOURNAL_TRANSITIONS.ARCHIVED).toEqual(['DRAFT'])
  })
})

describe('the helpers under the text boxes', () => {
  it('counts characters against the limit and says when it is passed', () => {
    expect(counter('  hello ', 300)).toEqual({ text: '5 / 300', over: false })
    expect(counter('x'.repeat(301), 300)).toEqual({ text: '301 / 300', over: true })
    expect(counter('', 40)).toEqual({ text: '0 / 40', over: false })
  })

  it('counts paragraphs: a blank line starts a new one, whatever the line endings', () => {
    expect(paragraphCount('')).toBe(0)
    expect(paragraphCount('One paragraph only')).toBe(1)
    expect(paragraphCount('One\n\nTwo\n\nThree')).toBe(3)
    expect(paragraphCount('One\r\n\r\nTwo')).toBe(2)
    expect(paragraphCount('One\nstill the same paragraph')).toBe(1)
    expect(paragraphCount('One\n\n\n\nTwo\n \nThree')).toBe(3)
  })

  it('warns, without blocking, about a missing cover and very short text', () => {
    expect(publishWarnings(article())).toHaveLength(2)
    const long = 'x'.repeat(200)
    expect(publishWarnings(article({ bodyEn: long, bodyAr: long, cover: { id: 'm', url: '/u.png' } as never }))).toEqual([])
    expect(publishWarnings(article({ bodyEn: long, bodyAr: 'short', cover: { id: 'm', url: '/u.png' } as never }))).toEqual(['The article text is very short in at least one language.'])
  })
})

describe('the Journal menu entry', () => {
  const canOnly = (...codes: string[]) => (p: string) => codes.includes(p)
  const labels = (can: (p: string) => boolean) => visibleNav(can).flatMap((g) => g.items.map((i) => i.label))

  it('is shown to anyone who may read Journal articles, under Park & content, and to nobody else', () => {
    expect(labels(canOnly('journal:read'))).toEqual(['Journal'])
    expect(visibleNav(canOnly('journal:read')).map((g) => g.title)).toEqual(['Park & content'])
    expect(labels(canOnly('journal:write', 'journal:publish'))).toEqual([]) // writing alone opens nothing: reading is what the page needs
    expect(labels(canOnly('events:read', 'orders:read'))).not.toContain('Journal')
    expect(labels(canOnly())).toEqual([])
  })

  it('decides by the permission code only, and its label is unique in the menu', () => {
    const items = NAV_GROUPS.flatMap((g) => g.items)
    const journal = items.find((i) => i.to === '/journal')
    expect(journal).toMatchObject({ label: 'Journal', anyOf: ['journal:read'] })
    expect(items.filter((i) => i.label === 'Journal')).toHaveLength(1)
  })
})
