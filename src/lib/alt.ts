import { useTranslation } from 'react-i18next'

type Pair = { en: string; ar: string }

// Image descriptions (read by screen readers and shown if an image fails to load), in both languages.
export const ALT = {
  parkMap: { en: 'Map of Al-Azhar Park', ar: 'خريطة حديقة الأزهر' },
  planMap: { en: 'Map of Al-Azhar Park with your route', ar: 'خريطة حديقة الأزهر ومسارك عليها' },
  aboutHero: {
    en: 'The royal palm promenade of Al-Azhar Park at golden hour, with visitors strolling beside the lake',
    ar: 'ممشى النخيل الملكي في حديقة الأزهر وقت الغروب، بينما يتنزه الزوار بجوار البحيرة',
  },
  aboutColonnade: {
    en: 'A shaded colonnade terrace overlooking the park, with the Citadel on the skyline',
    ar: 'شرفة مظللة ذات أروقة تطل على الحديقة، مع القلعة في الأفق',
  },
  aboutGarden: {
    en: 'Flowering garden beds beside the lake and restaurant pavilion',
    ar: 'أحواض الزهور بجوار البحيرة وجناح المطعم',
  },
  aboutRecognition: {
    en: 'The Lake Side Restaurant pavilion and formal water channel at Al-Azhar Park',
    ar: 'جناح مطعم البحيرة والقناة المائية المنتظمة في حديقة الأزهر',
  },
  homeHero: {
    en: 'Aerial view of Al-Azhar Park: the lake and lawns at the centre, the Citadel of Cairo on the horizon',
    ar: 'منظر جوي لحديقة الأزهر: البحيرة والمساحات الخضراء في المنتصف، وقلعة القاهرة في الأفق',
  },
  homeHistory: {
    en: "Al-Azhar Park's gardens and lake, with the Citadel of Cairo on the skyline",
    ar: 'حدائق الأزهر وبحيرتها، وقلعة القاهرة في الأفق',
  },
  homeBefore: {
    en: 'The same site before the park was built — a mound of rubble on the edge of the city',
    ar: 'الموقع نفسه قبل إنشاء الحديقة — تلّ من الأنقاض على أطراف المدينة',
  },
  eventsHero: {
    en: 'The lamp-lit palm avenue of Al-Azhar Park at night, with the Muhammad Ali Mosque glowing at its far end',
    ar: 'ممشى النخيل المضاء بالمصابيح ليلًا في حديقة الأزهر، ويتوهج مسجد محمد علي في نهايته',
  },
  eventsConcert: { en: 'Live music on the open lawn', ar: 'موسيقى حية على المساحة الخضراء المفتوحة' },
  contactHero: {
    en: 'The Mosque of Muhammad Ali at the end of the palm avenue in Al-Azhar Park',
    ar: 'مسجد محمد علي في نهاية ممشى النخيل بحديقة الأزهر',
  },
  galleryHero: { en: 'An evening event beneath the archways of Al-Azhar Park', ar: 'أمسية تحت أقواس حديقة الأزهر' },
  newsHero: {
    en: 'His Highness the Aga Khan welcomes the Prince of Wales and the Duchess of Cornwall into Al-Azhar Park',
    ar: 'صاحب السمو الآغا خان يستقبل أمير ويلز ودوقة كورنوال في حديقة الأزهر',
  },
  planHero: {
    en: 'The lamp-lit promenade and star-shaped fountain of Al-Azhar Park at dusk',
    ar: 'الممشى المضاء بالمصابيح والنافورة النجمية في حديقة الأزهر وقت الغسق',
  },
  restaurantsHero: {
    en: "The Lake Side Restaurant's wooden pavilion, surrounded by water with its terrace of dining umbrellas",
    ar: 'جناح مطعم البحيرة الخشبي تحيط به المياه، وشرفته تظلّلها مظلات الطعام',
  },
  ticketsHero: {
    en: 'Sandstone entrance gate of Al-Azhar Park with the ticket kiosk and visitors arriving',
    ar: 'بوابة حديقة الأزهر الحجرية وكشك التذاكر وزوار يصلون',
  },
} satisfies Record<string, Pair>

export type AltKey = keyof typeof ALT

function useLang(): 'en' | 'ar' {
  const { i18n } = useTranslation()
  return i18n.language === 'ar' ? 'ar' : 'en'
}

/** Localised image description: `const altText = useAlt()` → `altText('aboutHero')` */
export function useAlt() {
  const lang = useLang()
  return (key: AltKey) => ALT[key][lang]
}

/** Prices: "50 LE" in English, "٥٠ جنيه" in Arabic. */
export function useMoney() {
  const lang = useLang()
  return (amount: number) => (lang === 'ar' ? `${amount.toLocaleString('ar-EG')} جنيه` : `${amount} LE`)
}

/** "Photo: Name · Licence" / "الصورة: Name · Licence" for photographer credits. */
export function useCredit() {
  const { t } = useTranslation()
  return (author: string, license: string) => `${t('photoCredit')}: ${author} · ${license}`
}
