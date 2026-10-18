-- Journal: articles that staff write in the portal and the website shows on its "Journal" cards and article pages.
-- Two new tables and one new enum; no existing table is changed and no data is touched.
--   journal_articles       one row per article (bilingual: card text, full text, one tag), a cover image and a status
--   journal_article_media  the optional extra photos of an article, in order (same shape as event_media)
--
-- Rollback (nothing else references these objects; drop them in this order):
--   DROP TABLE journal_article_media;
--   DROP TABLE journal_articles;
--   DROP TYPE journal_status;

-- CreateEnum
CREATE TYPE "journal_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "journal_articles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT NOT NULL,
    "tag_en" TEXT NOT NULL,
    "tag_ar" TEXT NOT NULL,
    "short_description_en" TEXT NOT NULL,
    "short_description_ar" TEXT NOT NULL,
    "body_en" TEXT NOT NULL,
    "body_ar" TEXT NOT NULL,
    "date_label_en" TEXT,
    "date_label_ar" TEXT,
    "cover_media_id" UUID,
    "status" "journal_status" NOT NULL DEFAULT 'DRAFT',
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "journal_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_article_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "caption_en" TEXT,
    "caption_ar" TEXT,

    CONSTRAINT "journal_article_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "journal_articles_slug_key" ON "journal_articles"("slug");

-- CreateIndex
CREATE INDEX "ix_journal_status_published" ON "journal_articles"("status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "journal_article_media_article_id_media_id_key" ON "journal_article_media"("article_id", "media_id");

-- AddForeignKey
ALTER TABLE "journal_articles" ADD CONSTRAINT "journal_articles_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_article_media" ADD CONSTRAINT "journal_article_media_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "journal_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_article_media" ADD CONSTRAINT "journal_article_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules the database keeps whatever writes to it (the same style as the events table)
ALTER TABLE journal_articles ADD CONSTRAINT ck_journal_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80);
ALTER TABLE journal_articles ADD CONSTRAINT ck_journal_texts CHECK (
  btrim(title_en) <> '' AND btrim(title_ar) <> '' AND btrim(tag_en) <> '' AND btrim(tag_ar) <> ''
  AND btrim(short_description_en) <> '' AND btrim(short_description_ar) <> '' AND btrim(body_en) <> '' AND btrim(body_ar) <> ''
);
-- an article that is on the website has the moment it first went public
ALTER TABLE journal_articles ADD CONSTRAINT ck_journal_published_at CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL);
