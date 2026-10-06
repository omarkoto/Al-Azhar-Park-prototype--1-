import { describe, expect, it } from 'vitest'
import { en } from './en'
import { ar } from './ar'
import { applyRestaurants, restaurantHours, type PublicRestaurant } from './restaurantData'

const api = (over: Partial<PublicRestaurant> = {}): PublicRestaurant => ({
  slug: 'hilltop', nameEn: 'Hill-top Edited', nameAr: 'القمة المعدلة', brandEn: null, brandAr: null, taglineEn: 'New tagline', taglineAr: 'شعار جديد',
  descriptionEn: 'New English description', descriptionAr: 'وصف عربي جديد', atmosphereEn: null, atmosphereAr: null, opensAt: '13:00', closesAt: '01:00',
  closesAfterMidnight: true, instagramUrl: null, phones: ['0100 111 2222'], hero: null, gallery: [], menus: [], ...over,
})

describe('restaurant hours', () => {
  it('writes 24-hour hours the way the site always has, with Arabic digits in Arabic', () => {
    expect(restaurantHours('12:00', '00:00', 'en')).toBe('12:00 – 00:00')
    expect(restaurantHours('12:00', '00:00', 'ar')).toBe('١٢:٠٠ – ٠٠:٠٠')
    expect(restaurantHours(null, null, 'en')).toBeNull()
  })
})

describe('applyRestaurants', () => {
  it('leaves the built-in list when there is no answer or an empty one', () => {
    expect(applyRestaurants(en, null, 'en')).toBe(en)
    expect(applyRestaurants(en, [], 'en')).toBe(en)
  })

  it('replaces the listed restaurant\'s text in the chosen language and keeps the built-in photo when the portal has none', () => {
    const out = applyRestaurants(en, [api()], 'en').restaurants.list
    expect(out).toHaveLength(1) // the list is the portal's: the other built-in restaurants are not in it
    expect(out[0]).toMatchObject({ slug: 'hilltop', name: 'Hill-top Edited', tagline: 'New tagline', body: 'New English description', hours: '13:00 – 01:00', phones: ['0100 111 2222'] })
    expect(out[0].image).toBe(en.restaurants.list[0].image)
    expect(out[0].gallery).toEqual(en.restaurants.list[0].gallery)
    const arabic = applyRestaurants(ar, [api()], 'ar').restaurants.list[0]
    expect(arabic).toMatchObject({ name: 'القمة المعدلة', body: 'وصف عربي جديد', hours: '١٣:٠٠ – ٠١:٠٠' })
  })

  it('keeps built-in wording where the portal left a field empty', () => {
    const out = applyRestaurants(en, [api({ taglineEn: null, atmosphereEn: null, phones: [] })], 'en').restaurants.list[0]
    expect(out.tagline).toBe(en.restaurants.list[0].tagline)
    expect(out.atmosphere).toBe(en.restaurants.list[0].atmosphere)
    expect(out.phones).toEqual(en.restaurants.list[0].phones)
  })

  it('uses uploaded photos with the API address in front, and the first menu as the menu link', () => {
    const out = applyRestaurants(en, [api({
      hero: { url: '/api/v1/media/file/abc.webp', altEn: null, altAr: null },
      gallery: [{ url: '/api/v1/media/file/g1.webp', captionEn: null, captionAr: null }],
      menus: [{ nameEn: 'Dinner', nameAr: 'العشاء', kind: 'link', url: 'https://example.com/dinner.pdf' }],
    })], 'en').restaurants.list[0]
    // VITE_API_URL is not set while testing, so paths stay as they are; with it set they get the API origin
    expect(out.image).toContain('/api/v1/media/file/abc.webp')
    expect(out.gallery).toEqual([expect.stringContaining('/api/v1/media/file/g1.webp')])
    expect(out.menuUrl).toBe('https://example.com/dinner.pdf')
    expect(out.menus).toBeUndefined() // one menu: the page keeps its single "View menu" button
  })

  it('offers each menu by name when there are several, in the right language', () => {
    const list = [api({ menus: [
      { nameEn: 'Dinner', nameAr: 'العشاء', kind: 'link', url: 'https://example.com/d.pdf' },
      { nameEn: 'Lunch', nameAr: 'الغداء', kind: 'link', url: 'https://example.com/l.pdf' },
    ] })]
    expect(applyRestaurants(en, list, 'en').restaurants.list[0].menus).toEqual([{ label: 'Dinner', url: 'https://example.com/d.pdf' }, { label: 'Lunch', url: 'https://example.com/l.pdf' }])
    expect(applyRestaurants(ar, list, 'ar').restaurants.list[0].menus?.[0].label).toBe('العشاء')
  })

  it('shows a restaurant that exists only in the portal, with a placeholder photo until it has one', () => {
    const out = applyRestaurants(en, [api(), api({ slug: 'rooftop', nameEn: 'Rooftop Grill' })], 'en').restaurants.list
    expect(out.map((r) => r.slug)).toEqual(['hilltop', 'rooftop'])
    expect(out[1]).toMatchObject({ name: 'Rooftop Grill', phones: ['0100 111 2222'] })
    expect(out[1].image).toMatch(/restaurants-hero/)
  })

  it('follows the portal\'s order and drops restaurants that are switched off (they are not in the answer)', () => {
    const out = applyRestaurants(en, [api({ slug: 'masrawya' }), api({ slug: 'hilltop' })], 'en').restaurants.list
    expect(out.map((r) => r.slug)).toEqual(['masrawya', 'hilltop'])
  })

  it("sends 'Reserve a table' to the restaurant's own Instagram, and offers no button without one", () => {
    const out = applyRestaurants(en, [api({ instagramUrl: 'https://www.instagram.com/rooftop/' }), api({ slug: 'lakeside', instagramUrl: null })], 'en').restaurants.list
    expect(out[0].instagramUrl).toBe('https://www.instagram.com/rooftop/')
    expect(out[1].instagramUrl).toBeUndefined()
  })

  it('does not touch the rest of the page content', () => {
    const out = applyRestaurants(en, [api()], 'en')
    expect(out.hero).toBe(en.hero)
    expect(out.restaurants.title).toBe(en.restaurants.title)
  })
})
