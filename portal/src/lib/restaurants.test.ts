import { describe, expect, it } from 'vitest'
import { emptyRestaurantForm, formatBytes, formToRestaurant, hoursLabel, move, restaurantToForm, slugify, uploadProblem, type RestaurantData } from './restaurants'

const restaurant = (over: Partial<RestaurantData> = {}): RestaurantData => ({
  id: '1', slug: 'hilltop', nameEn: 'Hill-top', nameAr: 'القمة', brandEn: null, brandAr: null, taglineEn: 'T', taglineAr: null, shortDescriptionEn: null, shortDescriptionAr: null,
  descriptionEn: 'Description here', descriptionAr: 'وصف هنا', atmosphereEn: null, atmosphereAr: null, locationEn: null, locationAr: null, opensAt: '12:00', closesAt: '00:00',
  closesAfterMidnight: true, phones: ['0100 1', '0100 2'], reservationUrl: null, websiteUrl: null, instagramUrl: null, hero: null, gallery: [], menus: [], isActive: true,
  sortOrder: 1, updatedAt: '', ...over,
})

describe('restaurant form', () => {
  it('round-trips and turns blanks into null', () => {
    const payload = formToRestaurant(restaurantToForm(restaurant()), null)
    expect(payload).toMatchObject({ slug: 'hilltop', brandEn: null, taglineEn: 'T', taglineAr: null, opensAt: '12:00', closesAt: '00:00', phones: ['0100 1', '0100 2'], heroMediaId: null, isActive: true })
  })

  it('trims, drops empty phone lines and keeps the main photo id', () => {
    const f = { ...emptyRestaurantForm(), slug: ' x-y ', nameEn: ' N ', phones: ' 0100 1 \n\n 0100 2 \n', opensAt: '', closesAt: '' }
    const p = formToRestaurant(f, 'media-1')
    expect(p).toMatchObject({ slug: 'x-y', nameEn: 'N', phones: ['0100 1', '0100 2'], opensAt: null, closesAt: null, heroMediaId: 'media-1' })
  })
})

describe('slugify', () => {
  it('makes a clean address', () => {
    expect(slugify('Lake Side Restaurant')).toBe('lake-side-restaurant')
    expect(slugify("  Al Masrawya Café!  ")).toBe('al-masrawya-cafe')
    expect(slugify('مطعم')).toBe('') // nothing usable: the editor types one
    expect(slugify('x'.repeat(80))).toHaveLength(60)
  })
})

describe('move', () => {
  it('moves up and down and ignores impossible moves', () => {
    expect(move(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(move(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(move(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(move(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })
  it('does not change the original list', () => {
    const list = ['a', 'b']
    move(list, 0, 1)
    expect(list).toEqual(['a', 'b'])
  })
})

describe('labels', () => {
  it('describes hours, including after midnight', () => {
    expect(hoursLabel(restaurant())).toBe('12:00 – 00:00 (after midnight)')
    expect(hoursLabel(restaurant({ closesAt: '23:00', closesAfterMidnight: false }))).toBe('12:00 – 23:00')
    expect(hoursLabel(restaurant({ opensAt: null, closesAt: null }))).toBe('Hours not set')
  })
  it('formats file sizes', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1048576)).toBe('5.0 MB')
  })
})

describe('upload hints', () => {
  it('flags the obvious problems before uploading', () => {
    expect(uploadProblem({ name: 'a.png', size: 1000, type: 'image/png' })).toBeNull()
    expect(uploadProblem({ name: 'm.pdf', size: 1000, type: 'application/pdf' })).toBeNull()
    expect(uploadProblem({ name: 'a.svg', size: 1000, type: 'image/svg+xml' })).toMatch(/not a JPEG/)
    expect(uploadProblem({ name: 'big.png', size: 9 * 1048576, type: 'image/png' })).toMatch(/too large/)
    expect(uploadProblem({ name: 'm.pdf', size: 9 * 1048576, type: 'application/pdf' })).toBeNull() // PDFs may be larger
    expect(uploadProblem({ name: 'e.png', size: 0, type: 'image/png' })).toMatch(/empty/)
  })
})
