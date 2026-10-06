export type Lang = 'en' | 'ar'

export interface NavLink {
  label: string
  to: string
}

export interface StatItem {
  value: string
  label: string
}

export interface TimelineEvent {
  year: string
  title: string
  body: string
}

export interface Highlight {
  title: string
  body: string
  to: string
}

export interface Restaurant {
  slug: string
  name: string
  brand?: string
  phones: string[]
  /** where "Reserve a table" goes: the restaurant's own Instagram (set in the portal); no button without it */
  instagramUrl?: string
  menuUrl?: string
  /** present when the restaurant has several menus (the first is also menuUrl) */
  menus?: Array<{ label: string; url: string }>
  hours: string
  tagline: string
  body: string
  atmosphere: string
  image: string
  gallery: string[]
}

export interface Venue {
  name: string
  area: string
  capacity: string
  body: string
  image: string
}

export interface EventType {
  title: string
  body: string
}

export interface TicketRow {
  label: string
  weekday: string
  weekend: string
}

export interface TicketGroup {
  title: string
  note: string
  rows: TicketRow[]
}

export interface Amenity {
  title: string
  body: string
}

export interface FAQ {
  q: string
  a: string
}

export interface GalleryImage {
  src: string
  /** width ÷ height, so the masonry grid can reserve space before the image loads */
  ratio?: number
  caption: string
  category: string
}

// Data-driven shape for homepage "Coming Soon" events. Kept flat and
// serializable so static content here can later be swapped for API/CMS
// data without touching the components that render it.
export interface ComingSoonEvent {
  id: string
  slug: string
  title: string
  description: string
  body: string
  image: string
  date: string
  time: string
  /** ISO 8601 with offset — used for calendar entries */
  startsAt: string
  endsAt: string
  location: string
  status: string
  featured?: boolean
  /** extra photos (events from the portal) */
  gallery?: string[]
}

// Data-driven shape for the homepage "News" / editorial journal carousel.
export interface NewsGalleryImage {
  image: string
  alt: string
}

export interface NewsItem {
  id: string
  slug: string
  title: string
  excerpt: string
  content: string
  image: string
  category: string
  date: string
  featured?: boolean
  gallery?: NewsGalleryImage[]
}

export interface SiteContent {
  meta: {
    title: string
    tagline: string
  }
  nav: NavLink[]
  ticketsCta: string
  langToggle: string
  hero: {
    eyebrow: string
    title: string
    body: string
    ctaPrimary: string
    ctaSecondary: string
  }
  stats: StatItem[]
  ticketsSection: {
    eyebrow: string
    title: string
    body: string
  }
  visitorBar: {
    hoursLabel: string
    hoursValue: string
    ticketsLabel: string
    ticketsValue: string
    locationLabel: string
    locationValue: string
    restaurantsLabel: string
    restaurantsValue: string
  }
  intro: {
    eyebrow: string
    title: string
    body: string
  }
  highlights: Highlight[]
  historyTeaser: {
    eyebrow: string
    title: string
    body: string
    beforeLabel: string
    cta: string
  }
  restaurantsTeaser: {
    eyebrow: string
    title: string
    cta: string
  }
  eventsTeaser: {
    eyebrow: string
    title: string
    body: string
    cta: string
  }
  galleryTeaser: {
    eyebrow: string
    title: string
    cta: string
  }
  comingSoon: {
    eyebrow: string
    title: string
    body: string
    badge: string
    cta: string
    dateLabel: string
    locationLabel: string
    events: ComingSoonEvent[]
  }
  newsSection: {
    eyebrow: string
    title: string
    body: string
    cta: string
    viewAll: string
    items: NewsItem[]
  }
  visitTeaser: {
    eyebrow: string
    title: string
    body: string
    hoursLabel: string
    hours: string
    addressLabel: string
    address: string
    cta: string
  }
  about: {
    eyebrow: string
    title: string
    lead: string
    body: string
    transformationTitle: string
    transformationBefore: string
    transformationAfter: string
    transformationBody: string
    timelineTitle: string
    timeline: TimelineEvent[]
    recognitionTitle: string
    recognitionBody: string
    heritage: {
      greenLung: { eyebrow: string; quote: string; body: string }
      history: { eyebrow: string; title: string; body: string; facts: { value: string; label: string }[] }
      wall: {
        eyebrow: string
        title: string
        lead: string
        builderLabel: string
        materialLabel: string
        photoLabel: string
        layers: { year: string; builder: string; material: string; title: string; body: string; caption: string }[]
      }
    }
  }
  restaurants: {
    eyebrow: string
    title: string
    lead: string
    hoursNote: string
    list: Restaurant[]
  }
  events: {
    eyebrow: string
    title: string
    lead: string
    venuesTitle: string
    venues: Venue[]
    typesTitle: string
    types: EventType[]
    notableTitle: string
    notableBody: string
    notableNames: string[]
    cta: string
    planningTitle: string
    areaLabel: string
    capacityLabel: string
    suitedLabel: string
    scaleLabel: string
    enquireVenue: string
    photoLabel: string
    ctaTitle: string
    ctaBody: string
  }
  gallery: {
    eyebrow: string
    title: string
    lead: string
    allLabel: string
    images: GalleryImage[]
  }
  visit: {
    eyebrow: string
    title: string
    lead: string
    hoursTitle: string
    hours: { label: string; value: string }[]
    hoursNote: string
    ticketsTitle: string
    ticketsNote: string
    weekdayLabel: string
    weekendLabel: string
    ticketGroups: TicketGroup[]
    amenitiesTitle: string
    amenities: Amenity[]
    goodToKnowTitle: string
    goodToKnow: { icon: 'parking' | 'camera' | 'metro' | 'bus'; title: string; body: string }[]
    rulesTitle: string
    rulesIntro: string
    rules: string[]
    gettingThereTitle: string
    gettingThereBody: string
    faqTitle: string
    faqs: FAQ[]
  }
  contact: {
    eyebrow: string
    title: string
    lead: string
    addressLabel: string
    address: string
    phoneLabel: string
    phones: string[]
    emailLabel: string
    email: string
    formTitle: string
    formName: string
    formEmail: string
    formMessage: string
    formSubmit: string
    formSuccess: string
    formNote: string
    faxLabel: string
    fax: string
    mapTitle: string
    openInMaps: string
    getDirections: string
    socialTitle: string
  }
  footer: {
    tagline: string
    rights: string
  }
}
