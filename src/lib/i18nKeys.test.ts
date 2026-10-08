import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import i18n from './i18n'
import { BookingError, downloadTicketsPdf } from './booking'

const root = join(__dirname, '..')
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(tsx?)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

describe('translations', () => {
  const en = i18n.getResourceBundle('en', 'translation') as Record<string, string>
  const ar = i18n.getResourceBundle('ar', 'translation') as Record<string, string>

  it('English and Arabic have exactly the same keys', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
  })

  it('every translation key used by a page or component exists in both languages', () => {
    const used = new Set<string>()
    for (const file of sources(root)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1])
    }
    // keys chosen at run time, from a fixed list
    for (const status of ['VALID', 'PENDING', 'USED', 'CANCELLED', 'EXPIRED']) used.add(`ticketStatus_${status}`)
    const missing = [...used].filter((k) => !(k in en) || !(k in ar))
    expect(missing).toEqual([])
  })

  it('no Arabic text is left in English and no English in Arabic (for the ticket and booking keys)', () => {
    const arabic = /[؀-ۿ]/
    for (const key of Object.keys(en).filter((k) => /^(book|order|pay|checkout|ticketStatus)/.test(k))) {
      expect({ key, hasArabic: arabic.test(en[key]) }).toEqual({ key, hasArabic: false })
      expect({ key, hasArabic: arabic.test(ar[key]) }).toEqual({ key, hasArabic: true })
    }
  })
})

describe('ticket PDF download', () => {
  it('says so plainly when online booking is not configured', async () => {
    await expect(downloadTicketsPdf('AZP-2026-000001', 'k'.repeat(43), { lang: 'en' })).rejects.toBeInstanceOf(BookingError)
  })
})
