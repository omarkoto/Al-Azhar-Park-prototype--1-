-- Display fixes: "Hill-Top" is capitalised, and the Lake Side Restaurant is run by Granita.
UPDATE "restaurants" SET "name_en" = 'Hill-Top Restaurant' WHERE "slug" = 'hilltop' AND "name_en" = 'Hill-top Restaurant';
UPDATE "restaurants" SET "brand_en" = 'Granita', "brand_ar" = 'جرانيتا' WHERE "slug" = 'lakeside' AND "brand_en" IS NULL AND "brand_ar" IS NULL;
