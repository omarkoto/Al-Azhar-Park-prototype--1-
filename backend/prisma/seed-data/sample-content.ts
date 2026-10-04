/** Development-only sample content (mirrors what the public website shows today). Not seeded in production. */

export const VENUES = [
  { slug: 'sunken-garden', nameEn: 'Sunken Garden', nameAr: 'الحديقة الغائرة', capacity: 300, areaSqm: 1500, sortOrder: 1 },
  { slug: 'open-area', nameEn: 'Open Area', nameAr: 'المساحة المفتوحة', capacity: 4000, areaSqm: 5500, sortOrder: 2 },
  { slug: 'lake-side-restaurant', nameEn: 'Lake Side Restaurant', nameAr: 'مطعم البحيرة', capacity: 300, areaSqm: null, sortOrder: 3 },
] as const;

export const RESTAURANTS = [
  {
    slug: 'hilltop',
    nameEn: 'Hill-top Restaurant',
    nameAr: 'مطعم القمة',
    brandEn: 'Studio Misr',
    brandAr: 'ستوديو مصر',
    taglineEn: 'Fatimid-style dining above Old Cairo',
    taglineAr: 'تجربة طعام بطراز فاطمي فوق القاهرة القديمة',
    descriptionEn:
      'An impressive Fatimid-style building overlooking the greenery with a panoramic view of Old Cairo. The outdoor-indoor restaurant is the optimum choice for an oriental dining experience with a cultural scenery.',
    descriptionAr:
      'مبنى مهيب على الطراز الفاطمي يطل على المساحات الخضراء، ويوفر إطلالة بانورامية على القاهرة القديمة. ويجمع المطعم بين الجلسات الداخلية والخارجية، ليقدم تجربة طعام شرقية مميزة في أجواء تنبض بالتاريخ والثقافة.',
    opensAt: '12:00',
    closesAt: '00:00',
    phones: ['01207273747'],
    menuUrl: 'https://azharpark.com/menues/The%20Citadel%20Menu%20For%20Net%201-1-2023.pdf',
    sortOrder: 1,
  },
  {
    slug: 'lakeside',
    nameEn: 'Lake Side Restaurant',
    nameAr: 'مطعم البحيرة',
    taglineEn: 'Dining experience with a lake-view',
    taglineAr: 'تجربة طعام بإطلالة خلابة على البحيرة',
    descriptionEn:
      'Located in the middle of the lake, the restaurant is surrounded by flowing water from the cascade and fountains. An ideal place to take a break and have lunch while strolling through the park.',
    descriptionAr:
      'يقع المطعم وسط البحيرة، وتحيط به مياه الشلالات والنوافير المتدفقة. وهو المكان المثالي للاستراحة وتناول الغداء أثناء التجول في أرجاء الحديقة.',
    opensAt: '12:00',
    closesAt: '23:00',
    phones: ['01022776616', '01005506850', '01008222863'],
    menuUrl: 'https://azharpark.com/menues/Lakeside%20menu.pdf',
    sortOrder: 2,
  },
  {
    slug: 'masrawya',
    nameEn: 'Al Masrawya Café',
    nameAr: 'كافيه المصراوية',
    taglineEn: 'Coffee break & quick bite with a view',
    taglineAr: 'استراحة للقهوة ووجبة خفيفة بإطلالة مميزة',
    descriptionEn: "Situated at one of the park's highest points, allowing guests to view Cairo's historical beauty from above.",
    descriptionAr: 'يقع في واحدة من أعلى نقاط الحديقة، ويمنح رواده إطلالة بانورامية على جمال القاهرة التاريخية من الأعلى.',
    opensAt: '10:00',
    closesAt: '22:00',
    phones: ['01226534749'],
    menuUrl:
      'https://azharpark.com/menues/%E2%80%8E%E2%81%A8%D8%A7%D9%84%D9%85%D8%B5%D8%B1%D8%A7%D9%88%D9%8A%D8%A9%20%D9%85%D9%86%D9%8A%D9%88%202023%20Jan%2027%20%20For%20netpdf%E2%81%A9.pdf',
    sortOrder: 3,
  },
] as const;

/** Placeholder dates — the real schedule is entered by the content team in the portal. */
export const EVENTS = [
  {
    slug: 'ramadan-nights-in-the-garden',
    titleEn: 'Ramadan Nights in the Garden',
    titleAr: 'ليالي رمضان في الحديقة',
    shortDescriptionEn: 'Lantern-lit colonnades, suhoor menus and live music through the holy month.',
    shortDescriptionAr: 'أروقة تضيئها الفوانيس، وقوائم سحور مميزة، وموسيقى حية طوال الشهر الفضيل.',
    descriptionEn:
      "Through Ramadan, the park's colonnades and terraces stay open into the night, lit by lantern and candle. Expect suhoor menus at the restaurants, live music on the lawn, and a slower, more reflective version of the garden after dark.",
    descriptionAr:
      'طوال شهر رمضان، تبقى أروقة الحديقة وشرفاتها مفتوحة حتى وقت متأخر من الليل، مضاءة بالفوانيس والشموع. تنتظرك قوائم سحور في المطاعم، وموسيقى حية في المساحات الخضراء، ووجه أهدأ للحديقة بعد الغروب تغمره السكينة.',
    startsAt: '2027-02-08T20:00:00+02:00',
    endsAt: '2027-02-09T01:00:00+02:00',
    locationNameEn: 'Colonnade & Lake Side Restaurant',
    locationNameAr: 'الرواق ومطعم البحيرة',
    isFeatured: true,
    sortOrder: 1,
  },
  {
    slug: 'cairo-jazz-nights',
    titleEn: 'Cairo Jazz Nights',
    titleAr: 'ليالي الجاز بالقاهرة',
    shortDescriptionEn: 'An evening of live jazz on the open lawn, with the Citadel lit up behind the stage.',
    shortDescriptionAr: 'أمسية جاز حية على المساحة الخضراء المفتوحة، والقلعة مضاءة خلف المسرح.',
    descriptionEn:
      "Cairo Jazz Nights brings local and regional musicians to the park's open-air stage for an evening of live jazz, with food stalls and seating on the lawn.",
    descriptionAr:
      'تجمع ليالي الجاز بالقاهرة موسيقيين محليين وإقليميين على مسرح الحديقة المكشوف في أمسية جاز حية، مع أكشاك طعام ومقاعد على العشب.',
    startsAt: '2026-11-20T20:00:00+02:00',
    endsAt: '2026-11-20T23:00:00+02:00',
    locationNameEn: 'Open Area',
    locationNameAr: 'المساحة المفتوحة',
    isFeatured: false,
    sortOrder: 2,
  },
  {
    slug: 'artisan-market-days',
    titleEn: 'Artisan Market Days',
    titleAr: 'أيام سوق الحرف اليدوية',
    shortDescriptionEn: 'A weekend market of handicrafts from the workshops of Al-Darb Al-Ahmar.',
    shortDescriptionAr: 'سوق في نهاية الأسبوع لمشغولات حرفية من ورش الدرب الأحمر.',
    descriptionEn:
      'A seasonal market bringing woodwork, textiles and metalwork from the restored artisan workshops of Al-Darb Al-Ahmar into the park, alongside live demonstrations and a few food stalls.',
    descriptionAr:
      'سوق موسمي يجلب الأعمال الخشبية والمنسوجات والمعادن من ورش الحرفيين المرممة في الدرب الأحمر إلى الحديقة، إلى جانب عروض حرفية حية وبعض أكشاك الطعام.',
    startsAt: '2026-12-04T10:00:00+02:00',
    endsAt: '2026-12-04T18:00:00+02:00',
    locationNameEn: 'Main Promenade',
    locationNameAr: 'الممشى الرئيسي',
    isFeatured: false,
    sortOrder: 3,
  },
] as const;
