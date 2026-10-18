/** Development-only sample content (mirrors what the public website shows today). Not seeded in production. */

export const VENUES = [
  { slug: 'sunken-garden', nameEn: 'Sunken Garden', nameAr: 'الحديقة الغائرة', capacity: 300, areaSqm: 1500, sortOrder: 1 },
  { slug: 'open-area', nameEn: 'Open Area', nameAr: 'المساحة المفتوحة', capacity: 4000, areaSqm: 5500, sortOrder: 2 },
  { slug: 'lake-side-restaurant', nameEn: 'Lake Side Restaurant', nameAr: 'مطعم البحيرة', capacity: 300, areaSqm: null, sortOrder: 3 },
] as const;

export const RESTAURANTS = [
  {
    slug: 'hilltop',
    nameEn: 'Hill-Top Restaurant',
    nameAr: 'مطعم القلعة',
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
    brandEn: 'Granita',
    brandAr: 'جرانيتا',
    instagramUrl: 'https://www.instagram.com/granitacairo?srtk=aWxzcmwxdWttOGZp',
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
    dateLabelEn: '8 Feb – 9 Mar 2027',
    dateLabelAr: 'من ٨ فبراير إلى ٩ مارس ٢٠٢٧',
    timeLabelEn: 'Nightly, 8:00 PM – 1:00 AM',
    timeLabelAr: 'يوميًا، من ٨:٠٠ م حتى ١:٠٠ ص',
    status: 'COMING_SOON',
    isFeatured: true,
    sortOrder: 1,
  },
  {
    slug: 'cairo-jazz-nights',
    titleEn: 'Jazz Evenings on the Lawn',
    titleAr: 'أمسيات الجاز على المرج',
    shortDescriptionEn: 'Live jazz at sunset on the open lawn, with the Citadel glowing behind the stage.',
    shortDescriptionAr: 'جاز حيّ عند الغروب على المرج المفتوح، والقلعة تتوهج خلف المسرح.',
    descriptionEn:
      "Jazz Evenings on the Lawn brings local and regional musicians to the park's open-air stage for an evening of live jazz, with food stalls and seating on the lawn.",
    descriptionAr:
      'تجمع أمسيات الجاز على المرج موسيقيين محليين وإقليميين على مسرح الحديقة المكشوف في أمسية جاز حية، مع أكشاك طعام ومقاعد على العشب.',
    startsAt: '2026-11-20T20:00:00+02:00',
    endsAt: '2026-11-20T23:00:00+02:00',
    venueSlug: 'open-area',
    status: 'PUBLISHED',
    isFeatured: false,
    sortOrder: 2,
  },
  {
    slug: 'artisan-market-days',
    titleEn: 'Darb Al-Ahmar Artisan Weekend',
    titleAr: 'عطلة الحرفيين في الدرب الأحمر',
    shortDescriptionEn: 'Two days of woodwork, textiles and metalwork from the restored workshops beside the park.',
    shortDescriptionAr: 'يومان من الأعمال الخشبية والمنسوجات والمعادن من الورش المرممة المجاورة للحديقة.',
    descriptionEn:
      'A seasonal market bringing woodwork, textiles and metalwork from the restored artisan workshops of Al-Darb Al-Ahmar into the park, alongside live demonstrations and a few food stalls.',
    descriptionAr:
      'سوق موسمي يجلب الأعمال الخشبية والمنسوجات والمعادن من ورش الحرفيين المرممة في الدرب الأحمر إلى الحديقة، إلى جانب عروض حرفية حية وبعض أكشاك الطعام.',
    startsAt: '2026-12-04T10:00:00+02:00',
    endsAt: '2026-12-04T18:00:00+02:00',
    locationNameEn: 'Main Promenade',
    locationNameAr: 'الممشى الرئيسي',
    status: 'COMING_SOON',
    isFeatured: false,
    sortOrder: 3,
  },
] as const;

/** Development-only Journal articles: the same stories the website has built in, as published articles (no photos: the site shows its own pictures for these addresses). */
export const JOURNAL_ARTICLES = [
  {
    "slug": "khayamiya-market-restoration-begins",
    "titleEn": "Cairo's Governor launches restoration of the historic Khayamiya Market",
    "titleAr": "محافظ القاهرة يبدأ ترميم سوق الخيامية التراثي",
    "tagEn": "Heritage",
    "tagAr": "تراث",
    "shortDescriptionEn": "The first phase of restoring Cairo's historic tentmakers' market, Souq Al-Khayamiya, has begun — an 8-month, 100-million-pound project led by the Aga Khan Cultural Services – Egypt and ALIPH.",
    "shortDescriptionAr": "بدأت المرحلة الأولى من ترميم سوق الخيامية التراثي بقصبة رضوان بك — مشروع تتجاوز تكلفته ١٠٠ مليون جنيه بتمويل مشترك من مؤسسة أغاخان للخدمات الثقافية – مصر ومؤسسة «أليف».",
    "bodyEn": "Dr Ibrahim Saber, Governor of Cairo, inspected the start of the first phase of the restoration and rehabilitation of the historic Khayamiya Market at Qasabat Radwan Bey in the Central Cairo district. The work supports the commercial and craft activity already under way inside the market, as part of wider efforts to preserve the architectural heritage and traditional crafts of historic Cairo.\n\nThe project is jointly funded by the Aga Khan Cultural Services – Egypt and the ALIPH Foundation, at a cost of more than 100 million Egyptian pounds. The work will take eight months and is due to be completed in May 2027, in cooperation with the Cairo Governorate and the Ministries of Antiquities and Endowments.\n\nThe project aims to protect the architectural and historical value of the market, to preserve one of Cairo's most important centres of traditional handicrafts, to revive its cultural and economic role, and to make sure this heritage is passed on to future generations.\n\nThe Governor was accompanied on his tour by Dr Ahmed Anwar Atiyya Al-Adl, Deputy Governor of Cairo for the Western Zone; Sherif Arian, Chief Executive Officer of the Aga Khan Cultural Services – Egypt; Major General Ahmed Helmy, Director of Government Relations at the organisation; Walid Hegazy, Director of Projects and Asset Management at the Aga Khan organisation; Ashraf Boutros, consultant for the restoration of Qasabat Radwan and Al-Khayamiya; and a number of Governorate officials.\n\nThe Governor stressed that the project reflects the importance of treating heritage as a living asset that contributes to development, not merely a witness to the past. It combines the conservation of historic buildings with an improved urban environment and support for traditional activities, strengthening residents' bond with their cultural inheritance and boosting cultural tourism in Al-Darb Al-Ahmar.\n\nHe added that the work in the Khayamiya area is part of the effort to preserve the visual identity of historic Cairo and to strike a balance between safeguarding the authenticity of heritage sites and the needs of contemporary life. This reinforces the market's standing as a destination for handicrafts and folk heritage, and ensures that the colours and patterns of the Khayamiya remain part of Cairo's character and historical memory.\n\nThe Governor confirmed that the work has been coordinated in advance with the traders and shop owners in the area, so that business can continue and shops will not be closed during the restoration. This protects the traders' interests and livelihoods while safeguarding the historical and archaeological value of the place.\n\nHe also praised the role of the Aga Khan organisation in partnering with the Egyptian state to preserve and revive heritage, pointing to the importance of cooperating with international institutions concerned with heritage conservation on projects that revive historic areas while keeping their character and traditional activities.\n\nThe first phase of the restoration includes upgrading the shops, walls and floors; improving the lighting network; restoring the woodwork and mashrabiya screens; and repairing the market's wooden roof, one of the monument's most distinctive architectural features. Qasabat Radwan Bey is one of the few historic markets that still has its roof, and its restoration helps preserve the market's characteristic architecture.\n\nSouq Al-Khayamiya lies outside the historic gate of Bab Zuweila, behind the Mosque of Al-Salih Tala'i, and overlooks Al-Khayamiya Street in Al-Darb Al-Ahmar. The street is historically linked to the making, decorating and selling of tents and is one of the most important heritage craft areas in Cairo. The site is known as Qasabat Radwan Bey and is associated with commercial and urban structures from the Ottoman period and the 17th century. The qasaba was built in 1062 AH (1652 CE) and was registered as a monument in 1951.\n\nThe site is associated with Prince Radwan ibn Abdullah Al-Faqari, one of the leading Faqari emirs of the Ottoman era, who served as Emir of the Sultanic Banner in Egypt for two years and then as Emir of the Hajj for eight years. He lived through the reigns of Sultans Murad IV, Ibrahim I and Mehmed IV, and a number of Ottoman governors of Egypt. He died in 1066 AH (1655 CE).\n\nThe market's architecture reflects the nature of trade and daily life in Cairo through the ages. The monument combines varied architectural elements: a main entrance leading to a covered passage, open courtyards, stone storehouses and an architectural bench, along with storeys built of red brick and decorated wooden windows.\n\nThe covered roof is one of the monument's most notable features. It is made of wooden planks carried on beams that span its width, with rectangular openings that let in light and air. The area also has two prayer rooms, one eastern and one western, serving the traders and workers.\n\nThe market is tied to the craft of the Khayamiya, an authentic Egyptian craft based on cutting coloured fabrics and stitching them by hand into geometric and artistic patterns. Over generations it has developed from the making of tents and pavilions into a heritage art that expresses Egyptian identity. It is linked to social and religious occasions and to Islamic ornament, and its products are used to decorate homes and streets, especially during the month of Ramadan.\n\nToday the market's historic storehouses are used as workshops where Khayamiya is made and decorated and its products sold. This makes the site a living space that combines historic architecture with economic and craft activity, preserves inherited expertise and the craftspeople's livelihoods, and supports the passing of the craft on to new generations.",
    "bodyAr": "تفقد الدكتور إبراهيم صابر، محافظ القاهرة، بدء المرحلة الأولى من أعمال ترميم وإعادة تأهيل سوق الخيامية التراثي بقصبة رضوان بك بحي وسط القاهرة، لدعم الأنشطة التجارية والحرفية القائمة داخل السوق، في إطار جهود الحفاظ على التراث المعماري والحرف التقليدية بالقاهرة التاريخية.\n\nويُنفذ المشروع بتمويل مشترك من مؤسسة أغاخان للخدمات الثقافية – مصر، ومؤسسة «أليف» (ALIPH)، بتكلفة تتجاوز ١٠٠ مليون جنيه، وتستغرق الأعمال ثمانية أشهر، ومن المقرر الانتهاء منها في مايو ٢٠٢٧، بالتعاون مع محافظة القاهرة ووزارتي الآثار والأوقاف.\n\nويهدف المشروع إلى صون القيمة المعمارية والتاريخية للسوق، والحفاظ على أحد أبرز مراكز الحرف اليدوية التراثية في القاهرة، وإحياء دوره الثقافي والاقتصادي وضمان استمرار هذا الموروث للأجيال القادمة.\n\nرافق محافظ القاهرة في جولته د. أحمد أنور عطية العدل، نائب محافظ القاهرة للمنطقة الغربية، وشريف عريان المدير التنفيذي لمؤسسة أغاخان للخدمات الثقافية – مصر، واللواء أحمد حلمي، مدير إدارة العلاقات الحكومية بالمؤسسة، ووليد حجازي، مدير المشروعات وإدارة الأصول بمؤسسة أغاخان، وأشرف بطرس، استشاري ترميم قصبة رضوان والخيامية، وعدد من قيادات المحافظة.\n\nوأكد محافظ القاهرة أن المشروع يعكس أهمية التعامل مع التراث باعتباره رصيدًا حيًا يسهم في التنمية، وليس مجرد شاهد على الماضي؛ إذ يجمع بين صيانة المباني التاريخية وتحسين البيئة العمرانية ودعم الأنشطة التقليدية، بما يعزز ارتباط السكان بموروثهم الثقافي ويسهم في تنشيط السياحة الثقافية بمنطقة الدرب الأحمر.\n\nوأضاف محافظ القاهرة أن أعمال منطقة الخيامية تأتي ضمن الجهود الرامية إلى الحفاظ على الهوية البصرية للقاهرة التاريخية، وتحقيق التوازن بين صون أصالة المواقع التراثية ومتطلبات الحياة المعاصرة، بما يعزز مكانة السوق وجهةً للحرف اليدوية والتراث الشعبي، ويضمن استمرار ألوان الخيامية وزخارفها جزءًا من شخصية القاهرة وذاكرتها التاريخية.\n\nوأكد محافظ القاهرة أنه تم التنسيق المسبق مع التجار وأصحاب المحال الموجودة بالمنطقة، مراعاةً لاستمرار النشاط التجاري وعدم غلق المحال أثناء تنفيذ أعمال الترميم، بما يضمن الحفاظ على مصالح التجار ومصادر أرزاقهم، بالتوازي مع الحفاظ على القيمة التاريخية والأثرية للمكان.\n\nوثمّن محافظ القاهرة دور مؤسسة الأغاخان في مشاركة الدولة المصرية في الحفاظ على التراث وإحيائه، مشيرًا إلى أهمية التعاون مع المؤسسات الدولية المعنية بالحفاظ على التراث لتنفيذ مشروعات تسهم في إحياء المناطق التاريخية، مع الحفاظ على طبيعتها وأنشطتها التقليدية.\n\nوتشمل المرحلة الأولى لترميم سوق الخيامية رفع كفاءة المحال التجارية والحوائط والأرضيات، وتحسين شبكة الإضاءة، وترميم العناصر الخشبية والمشربيات، إلى جانب رفع كفاءة السقف الخشبي للسوق، الذي يُعد من أبرز العناصر المعمارية المميزة للأثر، حيث تُعد قصبة رضوان بك من الأسواق التاريخية القليلة التي لا تزال تحتفظ بسقفها، بما يسهم في صون ملامحه المعمارية المميزة.\n\nويقع سوق الخيامية خارج باب زويلة التاريخي، خلف جامع الصالح طلائع، ويطل على شارع الخيامية بمنطقة الدرب الأحمر، الذي يرتبط تاريخيًا بصناعة الخيام وزخرفتها وبيعها، ويُعد من أبرز المناطق الحرفية التراثية بالقاهرة. ويُعرف الموقع باسم «قصبة رضوان بك»، ويرتبط بمنشآت تجارية وعمرانية تعود إلى العصر العثماني والقرن السابع عشر. وقد أُنشئت القصبة عام ١٠٦٢هـ الموافق ١٦٥٢م، وسُجلت كأثر عام ١٩٥١.\n\nويرتبط الموقع بالأمير رضوان بن عبد الله الفقاري، أحد أبرز أمراء الفقارية في العصر العثماني، الذي تولى منصب أمير اللواء السلطاني بمصر لمدة عامين، ثم أمير الحج لمدة ثماني سنوات. وعاصر السلاطين مراد الرابع وإبراهيم الأول ومحمد الرابع، إلى جانب عدد من ولاة مصر، وتوفي عام ١٠٦٦هـ الموافق ١٦٥٥م.\n\nويتميز السوق بطرازه المعماري الذي يعكس طبيعة التجارة والحياة اليومية في القاهرة عبر العصور، ويتميز الأثر بتنوع عناصره المعمارية، إذ يضم مدخلًا رئيسيًا يؤدي إلى ممر مسقوف، وأفنية مكشوفة، وحواصل حجرية، ومقعدًا معماريًا، إلى جانب طوابق مبنية بالطوب الأحمر ونوافذ خشبية مزخرفة.\n\nوتُعد السقيفة من أبرز عناصر الأثر، حيث يتكون سقفها من ألواح خشبية محمولة على براطيم تمتد بعرضها، وتتخللها فتحات مستطيلة تسمح بدخول الإضاءة والتهوية. كما تضم المنطقة زاويتين للصلاة، شرقية وغربية، لخدمة التجار والعاملين.\n\nويرتبط السوق بحرفة الخيامية، وهي حرفة مصرية أصيلة تعتمد على قص الأقمشة الملونة وتطريزها يدويًا لتكوين زخارف هندسية وفنية، وتطورت عبر الأجيال من صناعة الخيام والسرادقات إلى فن تراثي يعبر عن الهوية المصرية، ويرتبط بالمناسبات الاجتماعية والدينية والزخارف الإسلامية، وتُستخدم منتجاتها في تزيين البيوت والشوارع، خاصة خلال شهر رمضان.\n\nوتُستخدم الحواصل التاريخية بالسوق حاليًا محالَّ لصناعة الخيامية وزخرفتها وبيع منتجاتها، ما يجعل الموقع مساحة حية تجمع بين العمارة التاريخية والنشاط الاقتصادي والحرفي، وتحافظ على الخبرات المتوارثة ومصادر رزق الحرفيين، وتدعم انتقال الحرفة إلى الأجيال الجديدة.",
    "dateLabelEn": "2026 – 2027",
    "dateLabelAr": "٢٠٢٦ – ٢٠٢٧",
    "isFeatured": false
  },
  {
    "slug": "a-royal-welcome-at-al-azhar-park",
    "titleEn": "A royal welcome at Al-Azhar Park",
    "titleAr": "استقبال ملكي في حديقة الأزهر",
    "tagEn": "History",
    "tagAr": "تاريخ",
    "shortDescriptionEn": "In 2006, the Prince of Wales and the Duchess of Cornwall — now King Charles III and Queen Camilla — toured the park as guests of its founding patron, His Highness the Aga Khan.",
    "shortDescriptionAr": "في عام ٢٠٠٦، زار أمير ويلز ودوقة كورنوال — الملك تشارلز الثالث والملكة كاميلا حاليًا — الحديقة كضيفين على راعيها المؤسس، صاحب السمو الآغا خان.",
    "bodyEn": "In 2006, the Prince of Wales and the Duchess of Cornwall — now King Charles III and Queen Camilla — visited Al-Azhar Park as guests of His Highness the Aga Khan, whose foundation had conceived and built the park the year before. The royal couple were welcomed through the colonnaded terrace above the Hill-Top Restaurant, with its view across the gardens to the Citadel and the mosque of Muhammad Ali, before touring the grounds alongside the restored stretch of the Ayyubid city wall uncovered during construction.\n\nA line of local schoolchildren waited at the park entrance to greet the royal party, waving small Union flags for the occasion — a detail that still turns up in the park's own photographs from that day, alongside the more formal shots of the Aga Khan leading his guests in through the gardens.",
    "bodyAr": "في عام ٢٠٠٦، زار أمير ويلز ودوقة كورنوال — الملك تشارلز الثالث والملكة كاميلا حاليًا — حديقة الأزهر كضيفين على صاحب السمو الآغا خان، الذي تصوّرت مؤسسته الحديقة وبنتها قبل ذلك بعام. استُقبل الثنائي الملكي عبر الشرفة ذات الأعمدة فوق مطعم القلعة، المطلة على الحدائق صوب القلعة ومسجد محمد علي، قبل جولة في أرجاء الحديقة إلى جانب الجزء المرمَّم من سور القاهرة الأيوبي الذي اكتُشف أثناء البناء.\n\nوانتظر صف من أطفال المدارس المحليين عند مدخل الحديقة لاستقبال الموكب الملكي، يلوّحون بأعلام بريطانية صغيرة بالمناسبة — تفصيلة ما زالت تظهر في صور الحديقة الخاصة من ذلك اليوم، إلى جانب اللقطات الأكثر رسمية للآغا خان وهو يقود ضيوفه عبر الحدائق.",
    "dateLabelEn": "2006",
    "dateLabelAr": "٢٠٠٦",
    "isFeatured": false
  },
  {
    "slug": "the-wall-beneath-the-garden",
    "titleEn": "The wall beneath the garden",
    "titleAr": "السور المدفون تحت الحديقة",
    "tagEn": "History",
    "tagAr": "تاريخ",
    "shortDescriptionEn": "Clearing the site for construction, engineers found something nobody expected: a buried stretch of Cairo's Ayyubid-era city wall.",
    "shortDescriptionAr": "أثناء تطهير الموقع للبناء، عثر المهندسون على ما لم يكن أحد يتوقعه: جزء مدفون من سور القاهرة الأيوبي.",
    "bodyEn": "When work began on the Al-Darassa mound in the early 1990s, the brief was straightforward: clear five hundred years of accumulated rubble and build a garden. Partway through, excavation crews uncovered something nobody had planned for — a long, buried stretch of Cairo's Ayyubid-era city wall, built in stone in the 12th and 13th centuries over an earlier mud-brick wall raised in 969 by Jawhar al-Siqilli, the general who founded Cairo.\n\nThe discovery stopped the project in its tracks. Rather than bury the wall again, the park's designers reshaped the entire layout around it, and the excavation led to a wider restoration effort in the adjoining Al-Darb Al-Ahmar district. A stretch of the wall is now visible from the park's western edge — a rare piece of medieval Cairo standing in the open air.",
    "bodyAr": "عندما بدأ العمل في تلّ الدرّاسة في أوائل التسعينيات، كانت المهمة واضحة: إزالة خمسمائة عام من الأنقاض المتراكمة وبناء حديقة. وفي منتصف الطريق، عثرت طواقم الحفر على ما لم يكن أحد يخطط له — جزء طويل مدفون من سور القاهرة الأيوبي، المبني بالحجر في القرنين الثاني عشر والثالث عشر فوق سور سابق من الطوب اللبن أقامه جوهر الصقلي، القائد الذي أسّس القاهرة، عام ٩٦٩.\n\nأوقف الاكتشاف المشروع مؤقتًا. وبدلًا من دفن السور مجددًا، أعاد مصممو الحديقة تشكيل التصميم بأكمله حوله، وأدى الاكتشاف إلى جهد أوسع لترميم منطقة الدرب الأحمر المجاورة. وأصبح جزء من السور اليوم مرئيًا من الطرف الغربي للحديقة — قطعة نادرة من قاهرة القرون الوسطى تقف في العراء.",
    "dateLabelEn": "1990s",
    "dateLabelAr": "تسعينيات القرن العشرين",
    "isFeatured": true
  },
  {
    "slug": "al-darb-al-ahmar-restored",
    "titleEn": "Al-Darb Al-Ahmar, restored",
    "titleAr": "الدرب الأحمر، بعد الترميم",
    "tagEn": "History",
    "tagAr": "تاريخ",
    "shortDescriptionEn": "The park's construction led to a wider restoration of historic monuments in the neighbouring district.",
    "shortDescriptionAr": "أدى بناء الحديقة إلى جهد أوسع لترميم الآثار التاريخية في المنطقة المجاورة.",
    "bodyEn": "Al-Darb Al-Ahmar, the historic quarter bordering the park's western edge, is home to some of Cairo's oldest standing monuments — mosques, houses and workshops dating back centuries. The discovery of the Ayyubid wall during the park's construction drew attention to the district's condition, and a parallel restoration effort followed: monuments were conserved, and local artisans were trained and supported to keep traditional crafts — woodwork, stonework, textiles — alive in the neighbourhood.\n\nThat restoration work continues today, and it's part of why a walk through Al-Azhar Park rarely stays inside the park's own walls for long — the view west, from almost anywhere on the grounds, looks straight into it.",
    "bodyAr": "الدرب الأحمر، الحي التاريخي المحاذي للطرف الغربي من الحديقة، يضم بعضًا من أقدم الآثار القائمة في القاهرة — مساجد وبيوتًا وورشًا يعود تاريخها لقرون. لفت اكتشاف السور الأيوبي أثناء بناء الحديقة الانتباه إلى حالة الحي، وتبع ذلك جهد ترميم موازٍ: صيانة الآثار، وتدريب الحرفيين المحليين ودعمهم للحفاظ على الحرف التقليدية — النجارة والحجر والمنسوجات — حيّةً في الحي.\n\nولا يزال هذا العمل مستمرًا حتى اليوم. وهو أحد الأسباب التي تجعل التنزه في حديقة الأزهر لا يقتصر على الحديقة وحدها؛ فمن أي نقطة تقريبًا، تطل الإطلالة غربًا مباشرة على الحي وآثاره.",
    "dateLabelEn": "Ongoing",
    "dateLabelAr": "مستمر",
    "isFeatured": false
  },
  {
    "slug": "three-tables-three-views",
    "titleEn": "Three Resturants, three views",
    "titleAr": "ثلاث موائد، وثلاث إطلالات",
    "tagEn": "Dining",
    "tagAr": "المطاعم",
    "shortDescriptionEn": "From a Fatimid-style terrace to the edge of the lake — a look at the three restaurants and what sets each apart.",
    "shortDescriptionAr": "من شرفة بطراز فاطمي إلى حافة البحيرة — نظرة على المطاعم الثلاثة وما يميّز كلًا منها.",
    "bodyEn": "Al-Azhar Park's three restaurants sit on three different edges of the garden, and each has its own idea of what a meal in the park should feel like. The Hill-Top Restaurant, in an impressive Fatimid-style building, looks out over Old Cairo with a panoramic view — best visited an hour before sunset. Lake Side Restaurant sits at the opposite end, open-air and relaxed, with tables spilling onto a terrace over the water. Al Masrawya Café, at one of the park's highest points, keeps things simple: coffee, a quick bite, and Cairo's historical skyline laid out below.\n\nNone of the three is trying to be the others, and that's deliberate — between them, they cover most of what a visitor to the park might want, from a quick break to a full evening out.",
    "bodyAr": "تقع مطاعم حديقة الأزهر الثلاثة على ثلاثة أطراف مختلفة من الحديقة، ولكل منها فكرته الخاصة عمّا يجب أن تكون عليه وجبة في الحديقة. يطل مطعم القلعة، وهو مبنى مهيب على الطراز الفاطمي، على القاهرة القديمة بإطلالة بانورامية — وأفضل وقت لزيارته قبل الغروب بساعة. أما مطعم البحيرة فيقع في الطرف المقابل، مفتوح وهادئ، بموائد تمتد إلى شرفة فوق البحيرة. أما كافيه المصراوية، في إحدى أعلى نقاط الحديقة، فيحافظ على البساطة: قهوة، ووجبة سريعة، وأفق القاهرة التاريخية ممتدًا أمامك.\n\nلا يحاول أي من الثلاثة أن يكون نسخة من الآخر، وهذا مقصود — فمعًا، يغطّون معظم ما قد يبحث عنه زائر الحديقة، من استراحة سريعة إلى أمسية كاملة.",
    "dateLabelEn": "Ongoing",
    "dateLabelAr": "مستمر",
    "isFeatured": false
  },
  {
    "slug": "one-of-the-worlds-great-public-spaces",
    "titleEn": "One of the world's great public spaces",
    "titleAr": "واحدة من أبرز المساحات العامة في العالم",
    "tagEn": "Recognition",
    "tagAr": "اعتراف عالمي",
    "shortDescriptionEn": "The park's design draws on the tradition of historic Islamic gardens — and has earned it a place on an international list.",
    "shortDescriptionAr": "يستلهم تصميم الحديقة تقاليد الحدائق الإسلامية التاريخية — وهو ما أكسبها مكانًا على قائمة عالمية.",
    "bodyEn": "Al-Azhar Park's design — formal water channels, a lake gathering at the southern end, and terraces aligned toward the Citadel — draws directly on the tradition of historic Islamic gardens, rather than reproducing a generic public park. It's a design language that shows up in small details throughout the grounds: the channels that feed the lake, the symmetry of the sunken garden, the framed views toward the city.\n\nThe park is described, in its own published materials, as one of the world's sixty great public spaces. We're presenting that as the park's own claim here, rather than one we've independently verified against a third-party ranking — but having walked it, it's not a hard claim to believe.",
    "bodyAr": "يستلهم تصميم حديقة الأزهر — القنوات المائية الرسمية، والبحيرة المتجمعة عند الطرف الجنوبي، والشرفات المحاذية للقلعة — تقاليد الحدائق الإسلامية التاريخية مباشرة، بدلًا من تكرار نموذج حديقة عامة عادية. وهي لغة تصميم تظهر في تفاصيل صغيرة في أرجاء الحديقة: القنوات التي تغذي البحيرة، وتناظر الحديقة الغائرة، والإطلالات المؤطَّرة نحو المدينة.\n\nتصف الحديقة نفسها، في موادها المنشورة، بأنها واحدة من أفضل ٦٠ مساحة عامة في العالم. ونذكر ذلك هنا كما ورد عنها، دون أن نكون قد تحققنا منه بصورة مستقلة مقابل تصنيف خارجي — لكنه، بعد التجول فيها، وصف ليس من الصعب تصديقه.",
    "dateLabelEn": "2005 – today",
    "dateLabelAr": "٢٠٠٥ – حتى اليوم",
    "isFeatured": false
  },
] as const;
