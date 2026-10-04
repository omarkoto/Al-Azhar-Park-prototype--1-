// The park's address, map links and phone helpers, shared by the Contact page and the footer.
export const PARK_PLACE = 'Al-Azhar Park, Salah Salem Street, Cairo, Egypt'

/** The park's own Google Maps listing */
export const MAPS_URL = 'https://www.google.com/maps?cid=13021591783999119538'

export const DIRECTIONS_URL = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(PARK_PLACE)}`

export function mapEmbedUrl(lang: 'en' | 'ar') {
  return `https://www.google.com/maps?q=${encodeURIComponent(PARK_PLACE)}&hl=${lang}&z=15&output=embed`
}

/** "(202) 2510 3868" → "tel:+20225103868" */
export function telHref(phone: string) {
  return `tel:+${phone.replace(/\D/g, '')}`
}
