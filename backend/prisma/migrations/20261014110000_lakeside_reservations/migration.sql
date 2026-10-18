-- "Reserve a table" at the Lake Side Restaurant goes to Granita's Instagram.
UPDATE "restaurants" SET "instagram_url" = 'https://www.instagram.com/granitacairo?srtk=aWxzcmwxdWttOGZp' WHERE "slug" = 'lakeside' AND "instagram_url" IS NULL;
