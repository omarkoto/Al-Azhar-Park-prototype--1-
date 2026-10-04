import type { Lang } from '../../content'
import type { Arrival } from './generate'
import type { Mood } from './stops'

interface PlanCopy {
  eyebrow: string
  title: string
  lead: string
  yourDay: string
  date: string
  adults: string
  children: string
  guests: string
  resident: string
  visitor: string
  arrival: string
  arrivals: Record<Arrival, string>
  duration: string
  hours: (n: number) => string
  mood: string
  moods: Record<Mood, string>
  sunset: string
  entrance: string
  walk: (min: number) => string
  walkLabel: string
  yourRoute: string
  routeNote: string
  total: string
  addTickets: string
  ticketsAdded: string
  openRestaurant: string
  planTitle: string
  stopsCount: (n: number) => string
  ctaTitle: string
  ctaBody: string
  ctaButton: string
}

export const planCopy: Record<Lang, PlanCopy> = {
  en: {
    eyebrow: 'Plan my day',
    title: 'Your perfect day at Al-Azhar Park, drawn for you.',
    lead: 'Tell us who is coming and what mood you are in. We will build a timed route through the gardens — and catch the sun setting behind the Citadel.',
    yourDay: 'Your day',
    date: 'Date',
    adults: 'Adults',
    children: 'Children (2–8)',
    guests: 'Who is coming',
    resident: 'Egyptian / resident',
    visitor: 'Visitor',
    arrival: 'Arrive in the',
    arrivals: { morning: 'Morning', afternoon: 'Afternoon', sunset: 'Golden hour' },
    duration: 'How long',
    hours: (n) => `${n} hours`,
    mood: 'Your mood',
    moods: { calm: 'Calm', scenic: 'Scenic', foodie: 'Foodie', culture: 'Culture' },
    sunset: 'Sunset',
    entrance: 'Entrance',
    walk: (min) => `${min} min walk`,
    walkLabel: 'walk',
    yourRoute: 'Your route',
    routeNote: 'Times are estimates for an unhurried pace. The park and restaurants may change their hours — confirm before you go.',
    total: 'Tickets for your party',
    addTickets: 'Add tickets to cart',
    ticketsAdded: 'Added to your cart',
    openRestaurant: 'View restaurant',
    planTitle: 'My day at Al-Azhar Park',
    stopsCount: (n) => `${n} stops`,
    ctaTitle: 'Not sure how to spend your day?',
    ctaBody: 'Choose your mood and who is coming — we will draw your route through the park, timed to the sunset over the Citadel.',
    ctaButton: 'Plan my day',
  },
  ar: {
    eyebrow: 'خطّط ليومك',
    title: 'يومك المثالي في حديقة الأزهر، نرسمه لك.',
    lead: 'أخبرنا من سيرافقك وما مزاجك اليوم. سنرسم لك مسارًا زمنيًا عبر الحدائق — ونصادف غروب الشمس خلف القلعة.',
    yourDay: 'يومك',
    date: 'التاريخ',
    adults: 'بالغون',
    children: 'أطفال (٢–٨)',
    guests: 'من سيأتي',
    resident: 'مصري / مقيم',
    visitor: 'زائر',
    arrival: 'الوصول في',
    arrivals: { morning: 'الصباح', afternoon: 'بعد الظهر', sunset: 'الساعة الذهبية' },
    duration: 'المدة',
    hours: (n) => (n === 2 ? 'ساعتان' : `${n} ساعات`),
    mood: 'مزاجك',
    moods: { calm: 'هدوء', scenic: 'مناظر', foodie: 'طعام', culture: 'ثقافة' },
    sunset: 'الغروب',
    entrance: 'المدخل',
    walk: (min) => (min === 2 ? 'دقيقتان سيرًا' : `${min.toLocaleString('ar-EG')} ${min <= 10 ? 'دقائق' : 'دقيقة'} سيرًا`),
    walkLabel: 'مشيًا',
    yourRoute: 'مسارك',
    routeNote: 'الأوقات تقديرية لوتيرة هادئة. قد تتغير مواعيد الحديقة والمطاعم — يُرجى التأكد قبل الزيارة.',
    total: 'تذاكر مجموعتك',
    addTickets: 'أضف التذاكر إلى السلة',
    ticketsAdded: 'تمت الإضافة إلى السلة',
    openRestaurant: 'عرض المطعم',
    planTitle: 'يومي في حديقة الأزهر',
    stopsCount: (n) => `${n.toLocaleString('ar-EG')} ${n <= 10 ? 'محطات' : 'محطة'}`,
    ctaTitle: 'لا تعرف كيف تقضي يومك؟',
    ctaBody: 'اختر مزاجك ومن سيرافقك — وسنرسم لك مسارك في الحديقة، بحيث يتزامن مع موعد غروب الشمس فوق القلعة.',
    ctaButton: 'خطّط ليومي',
  },
}
