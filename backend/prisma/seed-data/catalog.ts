/** Initial reference data. All of it is editable from the portal afterwards; the seed never overwrites edits. */

// Weekday bit masks: Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64
export const DOW_WEEKDAY = 1 | 2 | 4 | 8 | 16; // Sun–Thu  = 31
export const DOW_WEEKEND = 32 | 64; //            Fri–Sat  = 96

export const TICKET_AUDIENCES = [
  { code: 'RESIDENT', nameEn: 'Egyptian / resident', nameAr: 'مصري / مقيم', sortOrder: 1 },
  { code: 'VISITOR', nameEn: 'Non-resident visitor', nameAr: 'زائر غير مقيم', sortOrder: 2 },
] as const;

export const TICKET_TYPES = [
  { code: 'ADULT', nameEn: 'Adult', nameAr: 'بالغ', minAge: 9, maxAge: null, sortOrder: 1 },
  { code: 'CHILD', nameEn: 'Child (2–8 years)', nameAr: 'طفل (٢–٨ سنوات)', minAge: 2, maxAge: 8, sortOrder: 2 },
] as const;

/**
 * Initial price list, from the official/current website data. Amounts are in EGP **piastres**
 * (50 EGP = 5000). These rows are DATA: the portal can close them and add new ones; no code depends on the numbers.
 */
export const INITIAL_TICKET_PRICES = [
  { type: 'ADULT', audience: 'RESIDENT', dowMask: DOW_WEEKDAY, amountMinor: 5000 },
  { type: 'ADULT', audience: 'RESIDENT', dowMask: DOW_WEEKEND, amountMinor: 6000 },
  { type: 'CHILD', audience: 'RESIDENT', dowMask: DOW_WEEKDAY, amountMinor: 3500 },
  { type: 'CHILD', audience: 'RESIDENT', dowMask: DOW_WEEKEND, amountMinor: 4000 },
  { type: 'ADULT', audience: 'VISITOR', dowMask: DOW_WEEKDAY, amountMinor: 15000 },
  { type: 'ADULT', audience: 'VISITOR', dowMask: DOW_WEEKEND, amountMinor: 20000 },
  { type: 'CHILD', audience: 'VISITOR', dowMask: DOW_WEEKDAY, amountMinor: 10000 },
  { type: 'CHILD', audience: 'VISITOR', dowMask: DOW_WEEKEND, amountMinor: 15000 },
] as const;
/** Standard prices are effective from here (earlier than any bookable date). */
export const INITIAL_PRICES_VALID_FROM = '2026-01-01';

export const GATES = [
  { code: 'MAIN', nameEn: 'Main entrance', nameAr: 'المدخل الرئيسي' },
  { code: 'DARASSA', nameEn: 'Darassa entrance', nameAr: 'مدخل الدرّاسة' },
] as const;

/** Sunday–Saturday 09:00–22:00 initially; every weekday has its own row so any day can differ later. */
export const DEFAULT_OPENING = { opens: '09:00', closes: '22:00' } as const;

export const PARK_SETTINGS = {
  nameEn: 'Al-Azhar Park',
  nameAr: 'حديقة الأزهر',
  taglineEn: 'The green heart of historic Cairo',
  taglineAr: 'القلب الأخضر للقاهرة التاريخية',
  descriptionEn:
    'Al-Azhar Park was conceived as a gift to the people of Cairo — and became one of the most significant urban restoration projects in the Middle East.',
  descriptionAr:
    'وُلدت حديقة الأزهر هدية لأهل القاهرة، لتصبح واحدة من أهم مشاريع إعادة إحياء المدن في الشرق الأوسط.',
  stats: [
    { value: '74', labelEn: 'Acres of gardens and terraces', labelAr: 'فدانًا (٣٠ هكتارًا) من الحدائق والشرفات' },
    { value: '1984', labelEn: 'Year the park was conceived', labelAr: 'العام الذي وُلدت فيه فكرة الحديقة' },
    { value: '2005', labelEn: 'Year the park opened to the public', labelAr: 'عام افتتاح الحديقة للجمهور' },
    { value: '60', labelEn: "Named one of the world's 60 great public spaces", labelAr: 'مُدرجة ضمن ٦٠ مساحة عامة كبرى في العالم' },
  ],
};

export const CONTACT_INFORMATION = {
  addressEn: 'Salah Salem Street, Cairo, Egypt',
  addressAr: 'شارع صلاح سالم، القاهرة، مصر',
  phones: ['(202) 2510 3868', '(202) 2510 7338'],
  fax: '(202) 2506 5717',
  email: 'info@alazharpark.com',
  mapsUrl: 'https://www.google.com/maps?cid=13021591783999119538',
};

/**
 * Operational defaults, editable in the portal. They are starting points, not business decisions:
 * confirm each one with the park before launch (see docs/ticketing.md).
 */
export const SYSTEM_SETTINGS = [
  { key: 'orders.pendingExpiryMinutes', value: 30, description: 'Minutes an unpaid ONLINE order stays valid before it expires' },
  { key: 'booking.maxTicketsPerOrder', value: 50, description: 'Most tickets one online order may contain (all types together)' },
  { key: 'booking.maxAdvanceDays', value: 90, description: 'How many days ahead a visit date can be booked' },
  // Business rule: same-day tickets can be bought until exactly this many minutes before CLOSING time.
  // The closing time itself always comes from the opening-hours tables (weekly + special dates), never a constant.
  { key: 'booking.sameDayCutoffMinutesBeforeClose', value: 60, description: 'Same-day ticket sales stop this many minutes before the park closes' },
  // Business rule: there is no daily capacity limit for now. null = unlimited; a number turns the limit on.
  { key: 'capacity.dailyLimit', value: null, description: 'Maximum tickets per visit date. null = unlimited (no limit today)' },
  { key: 'privacy.noticeVersion', value: 'draft-0', description: 'Version of the privacy notice customers accept (text is managed outside the code)' },
] as const;
