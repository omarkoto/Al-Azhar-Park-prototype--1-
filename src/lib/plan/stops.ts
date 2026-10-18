import type { Lang } from '../../content'
import entranceImg from '../../assets/images/tickets-hero-entrance.webp'
import palmsImg from '../../assets/images/plan-royal-palm-promenade.jpg'
import lakesideImg from '../../assets/images/lakeside-hero-panorama.jpg'
import masrawyaImg from '../../assets/images/restaurant-masrawya.webp'
import telescopeImg from '../../assets/images/visitor-info-garden.webp'
import wallImg from '../../assets/images/history-monuments-collage.jpg'
import amphitheatreImg from '../../assets/images/events-hero.webp'
import playImg from '../../assets/images/venue-open-area.webp'
import hilltopImg from '../../assets/images/hilltop-sunset.jpg'

export type Mood = 'calm' | 'scenic' | 'foodie' | 'culture'

type Text = Record<Lang, string>

export interface Stop {
  id: string
  /** Position on the 1000×560 stylised map. */
  x: number
  y: number
  /** Typical time spent here, minutes. */
  minutes: number
  moods: Mood[]
  /** 'only' = shown just when children are in the party; 'good' = a bonus when they are. */
  kids?: 'only' | 'good'
  /** The stop the "golden hour" plan is built around. */
  sunset?: boolean
  restaurantSlug?: string
  image: string
  name: Text
  blurb: Text
}

export const entrance = {
  x: 500,
  y: 400,
  name: { en: 'Park Entrance', ar: 'مدخل الحديقة' } as Text,
  image: entranceImg,
}

export const stops: Stop[] = [
  {
    id: 'palms',
    x: 400,
    y: 370,
    minutes: 25,
    moods: ['calm', 'scenic'],
    kids: 'good',
    image: palmsImg,
    name: { en: 'Royal Palm Promenade', ar: 'ممشى النخيل' },
    blurb: {
      en: 'Stroll the long axis lined with royal palms, straight toward the lake.',
      ar: 'تمشَّ في الممشى الطويل المحاط بالنخيل الملكي، متجهًا نحو البحيرة.',
    },
  },
  {
    id: 'lakeside',
    x: 210,
    y: 322,
    minutes: 50,
    moods: ['calm', 'foodie'],
    restaurantSlug: 'lakeside',
    image: lakesideImg,
    name: { en: 'Lake Side Restaurant', ar: 'مطعم البحيرة' },
    blurb: {
      en: 'A long lunch or a slow coffee at tables right over the water.',
      ar: 'غداء هادئ أو قهوة بطيئة على موائد فوق الماء مباشرة.',
    },
  },
  {
    id: 'masrawya',
    x: 320,
    y: 265,
    minutes: 30,
    moods: ['foodie', 'calm'],
    restaurantSlug: 'masrawya',
    image: masrawyaImg,
    name: { en: 'Al Masrawya Café', ar: 'كافيه المصراوية' },
    blurb: {
      en: 'Coffee and a quick bite, with a view over Cairo from one of the highest points.',
      ar: 'قهوة ووجبة سريعة مع إطلالة على القاهرة من إحدى أعلى النقاط.',
    },
  },
  {
    id: 'telescope',
    x: 445,
    y: 252,
    minutes: 20,
    moods: ['scenic', 'culture'],
    kids: 'good',
    image: telescopeImg,
    name: { en: 'The Telescope', ar: 'التلسكوب' },
    blurb: {
      en: 'A lookout over the gardens and the rooftops of the old city.',
      ar: 'نقطة مراقبة تطل على الحدائق وأسطح القاهرة القديمة.',
    },
  },
  {
    id: 'amphitheatre',
    x: 560,
    y: 212,
    minutes: 20,
    moods: ['culture', 'scenic'],
    image: amphitheatreImg,
    name: { en: 'The Amphitheatre', ar: 'مسرح الجنينة' },
    blurb: {
      en: 'The open-air stage where the park hosts its concerts and festivals.',
      ar: 'المسرح المفتوح الذي تقيم فيه الحديقة حفلاتها ومهرجاناتها.',
    },
  },
  {
    id: 'wall',
    x: 700,
    y: 196,
    minutes: 30,
    moods: ['culture'],
    image: wallImg,
    name: { en: 'Ayyubid Historical Wall', ar: 'السور الأيوبي' },
    blurb: {
      en: 'Walk beside the 12th-century city wall that was uncovered beneath the rubble.',
      ar: 'امشِ بجوار سور المدينة من القرن الثاني عشر الذي كُشف عنه تحت الأنقاض.',
    },
  },
  {
    id: 'play',
    x: 862,
    y: 325,
    minutes: 40,
    moods: ['calm'],
    kids: 'only',
    image: playImg,
    name: { en: "Children's Play Area", ar: 'منطقة ألعاب الأطفال' },
    blurb: {
      en: 'Space for the little ones to run, climb and play.',
      ar: 'مساحة للصغار ليركضوا ويتسلقوا ويلعبوا.',
    },
  },
  {
    id: 'hilltop',
    x: 722,
    y: 288,
    minutes: 70,
    moods: ['scenic', 'foodie'],
    sunset: true,
    restaurantSlug: 'hilltop',
    image: hilltopImg,
    name: { en: 'Hill-Top & Citadel View', ar: 'مطعم القلعة وإطلالة القلعة' },
    blurb: {
      en: 'Dine in a Fatimid-style building with a panoramic view of Old Cairo.',
      ar: 'عشاء في مبنى بطراز فاطمي تطل منه بانوراما القاهرة القديمة.',
    },
  },
]
