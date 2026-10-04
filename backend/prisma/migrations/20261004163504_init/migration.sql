-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "order_channel" AS ENUM ('ONLINE', 'COUNTER_SALE');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('ONLINE', 'CASH');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('PENDING', 'VALID', 'USED', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "scan_result" AS ENUM ('VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "scan_reason" AS ENUM ('OK', 'NOT_FOUND', 'ALREADY_USED', 'CANCELLED', 'REFUNDED', 'EXPIRED', 'WRONG_DATE', 'NOT_PAID', 'INVALID_TOKEN');

-- CreateEnum
CREATE TYPE "price_kind" AS ENUM ('STANDARD', 'SPECIAL', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "special_hours_kind" AS ENUM ('HOLIDAY', 'TEMPORARY_CLOSURE', 'SPECIAL_HOURS');

-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "data_request_type" AS ENUM ('ACCESS', 'DELETION', 'ANONYMIZATION');

-- CreateEnum
CREATE TYPE "data_request_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "request_status" AS ENUM ('NEW', 'CONFIRMED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" TEXT NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "country" TEXT,
    "privacy_notice_version" TEXT,
    "consented_at" TIMESTAMPTZ(3),
    "anonymized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID,
    "type" "data_request_type" NOT NULL,
    "status" "data_request_status" NOT NULL DEFAULT 'OPEN',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "handled_by_id" UUID,
    "notes" TEXT,

    CONSTRAINT "data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_audiences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "description_en" TEXT,
    "description_ar" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ticket_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "description_en" TEXT,
    "description_ar" TEXT,
    "min_age" INTEGER NOT NULL DEFAULT 2,
    "max_age" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_type_id" UUID NOT NULL,
    "audience_id" UUID NOT NULL,
    "kind" "price_kind" NOT NULL DEFAULT 'STANDARD',
    "name_en" TEXT,
    "name_ar" TEXT,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dow_mask" SMALLINT NOT NULL DEFAULT 127,
    "special_dates" DATE[] DEFAULT ARRAY[]::DATE[],
    "promo_code" TEXT,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ticket_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_number" TEXT NOT NULL,
    "customer_id" UUID,
    "channel" "order_channel" NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "visit_date" DATE NOT NULL,
    "subtotal_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL DEFAULT 0,
    "total_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "promo_code" TEXT,
    "idempotency_key" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_access_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "ticket_type_id" UUID NOT NULL,
    "audience_id" UUID NOT NULL,
    "ticket_price_id" UUID NOT NULL,
    "type_name_en" TEXT NOT NULL,
    "type_name_ar" TEXT NOT NULL,
    "audience_name_en" TEXT NOT NULL,
    "audience_name_ar" TEXT NOT NULL,
    "unit_price_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "quantity" INTEGER NOT NULL,
    "line_total_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "method" "payment_method" NOT NULL,
    "provider_txn_id" TEXT,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(3),
    "recorded_by_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_ref" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "customer_id" UUID,
    "ticket_type_id" UUID NOT NULL,
    "audience_id" UUID NOT NULL,
    "visit_date" DATE NOT NULL,
    "price_paid_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "holder_name" TEXT,
    "status" "ticket_status" NOT NULL DEFAULT 'PENDING',
    "qr_key_id" SMALLINT NOT NULL DEFAULT 1,
    "issued_at" TIMESTAMPTZ(3),
    "used_at" TIMESTAMPTZ(3),
    "used_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID,
    "token_fingerprint" TEXT,
    "scanned_by_id" UUID NOT NULL,
    "gate_id" UUID,
    "result" "scan_result" NOT NULL,
    "reason" "scan_reason" NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device" JSONB,
    "ip" TEXT,

    CONSTRAINT "ticket_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_counters" (
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reference_counters_pkey" PRIMARY KEY ("kind","year")
);

-- CreateTable
CREATE TABLE "park_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "tagline_en" TEXT,
    "tagline_ar" TEXT,
    "description_en" TEXT,
    "description_ar" TEXT,
    "stats" JSONB NOT NULL DEFAULT '[]',
    "visitor_info" JSONB NOT NULL DEFAULT '{}',
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "park_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_information" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "address_en" TEXT NOT NULL,
    "address_ar" TEXT NOT NULL,
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fax" TEXT,
    "email" TEXT,
    "maps_url" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "social_links" JSONB NOT NULL DEFAULT '{}',
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_information_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "day_of_week" SMALLINT NOT NULL,
    "opens" TIME(0),
    "closes" TIME(0),
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "opening_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "special_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "special_hours_kind" NOT NULL,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "opens" TIME(0),
    "closes" TIME(0),
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "label_en" TEXT NOT NULL,
    "label_ar" TEXT NOT NULL,
    "note_en" TEXT,
    "note_ar" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "special_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "description_en" TEXT,
    "description_ar" TEXT,
    "capacity" INTEGER,
    "area_sqm" INTEGER,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT NOT NULL,
    "short_description_en" TEXT NOT NULL,
    "short_description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "description_ar" TEXT NOT NULL,
    "hero_media_id" UUID,
    "status" "event_status" NOT NULL DEFAULT 'DRAFT',
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "date_label_en" TEXT,
    "date_label_ar" TEXT,
    "time_label_en" TEXT,
    "time_label_ar" TEXT,
    "venue_id" UUID,
    "location_name_en" TEXT,
    "location_name_ar" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "caption_en" TEXT,
    "caption_ar" TEXT,

    CONSTRAINT "event_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "brand_en" TEXT,
    "brand_ar" TEXT,
    "tagline_en" TEXT,
    "tagline_ar" TEXT,
    "short_description_en" TEXT,
    "short_description_ar" TEXT,
    "description_en" TEXT NOT NULL,
    "description_ar" TEXT NOT NULL,
    "atmosphere_en" TEXT,
    "atmosphere_ar" TEXT,
    "location_en" TEXT,
    "location_ar" TEXT,
    "opens_at" TIME(0),
    "closes_at" TIME(0),
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reservation_url" TEXT,
    "website_url" TEXT,
    "instagram_url" TEXT,
    "hero_media_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "caption_en" TEXT,
    "caption_ar" TEXT,

    CONSTRAINT "restaurant_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "external_url" TEXT,
    "pdf_media_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "menu_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "description_en" TEXT,
    "description_ar" TEXT,
    "price_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "media_id" UUID,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL DEFAULT 'local',
    "storage_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt_en" TEXT,
    "alt_ar" TEXT,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "privacy_notice_version" TEXT,
    "handled_by_id" UUID,
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "party_size" INTEGER NOT NULL,
    "visit_date" DATE,
    "preferred_time" TIME(0),
    "notes" TEXT,
    "status" "request_status" NOT NULL DEFAULT 'NEW',
    "handled_by_id" UUID,
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel" "notification_channel" NOT NULL,
    "template" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "related_order_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "customers_email_idx" ON "customers"("email");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "data_requests_status_idx" ON "data_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_audiences_code_key" ON "ticket_audiences"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_types_code_key" ON "ticket_types"("code");

-- CreateIndex
CREATE INDEX "ticket_prices_ticket_type_id_audience_id_valid_from_idx" ON "ticket_prices"("ticket_type_id", "audience_id", "valid_from");

-- CreateIndex
CREATE INDEX "ticket_prices_valid_from_valid_to_idx" ON "ticket_prices"("valid_from", "valid_to");

-- CreateIndex
CREATE UNIQUE INDEX "gates_code_key" ON "gates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "orders_visit_date_idx" ON "orders"("visit_date");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_channel_created_at_idx" ON "orders"("channel", "created_at");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_access_tokens_token_hash_key" ON "order_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "order_access_tokens_order_id_idx" ON "order_access_tokens"("order_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_txn_id_key" ON "payments"("provider", "provider_txn_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_public_ref_key" ON "tickets"("public_ref");

-- CreateIndex
CREATE INDEX "tickets_visit_date_status_idx" ON "tickets"("visit_date", "status");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_order_id_idx" ON "tickets"("order_id");

-- CreateIndex
CREATE INDEX "tickets_customer_id_idx" ON "tickets"("customer_id");

-- CreateIndex
CREATE INDEX "ticket_scans_scanned_at_idx" ON "ticket_scans"("scanned_at");

-- CreateIndex
CREATE INDEX "ticket_scans_ticket_id_idx" ON "ticket_scans"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_scans_scanned_by_id_scanned_at_idx" ON "ticket_scans"("scanned_by_id", "scanned_at");

-- CreateIndex
CREATE INDEX "ticket_scans_gate_id_scanned_at_idx" ON "ticket_scans"("gate_id", "scanned_at");

-- CreateIndex
CREATE INDEX "ticket_scans_result_reason_idx" ON "ticket_scans"("result", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "opening_hours_day_of_week_key" ON "opening_hours"("day_of_week");

-- CreateIndex
CREATE INDEX "special_hours_date_from_date_to_idx" ON "special_hours"("date_from", "date_to");

-- CreateIndex
CREATE UNIQUE INDEX "venues_slug_key" ON "venues"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_status_starts_at_idx" ON "events"("status", "starts_at");

-- CreateIndex
CREATE INDEX "events_starts_at_idx" ON "events"("starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_media_event_id_media_id_key" ON "event_media"("event_id", "media_id");

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_slug_key" ON "restaurants"("slug");

-- CreateIndex
CREATE INDEX "restaurants_is_active_sort_order_idx" ON "restaurants"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_media_restaurant_id_media_id_key" ON "restaurant_media"("restaurant_id", "media_id");

-- CreateIndex
CREATE INDEX "menus_restaurant_id_sort_order_idx" ON "menus"("restaurant_id", "sort_order");

-- CreateIndex
CREATE INDEX "menu_categories_menu_id_sort_order_idx" ON "menu_categories"("menu_id", "sort_order");

-- CreateIndex
CREATE INDEX "menu_items_category_id_sort_order_idx" ON "menu_items"("category_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "media_storage_key_key" ON "media"("storage_key");

-- CreateIndex
CREATE INDEX "contact_messages_created_at_idx" ON "contact_messages"("created_at");

-- CreateIndex
CREATE INDEX "reservation_requests_status_created_at_idx" ON "reservation_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_prices" ADD CONSTRAINT "ticket_prices_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_prices" ADD CONSTRAINT "ticket_prices_audience_id_fkey" FOREIGN KEY ("audience_id") REFERENCES "ticket_audiences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_prices" ADD CONSTRAINT "ticket_prices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_access_tokens" ADD CONSTRAINT "order_access_tokens_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_audience_id_fkey" FOREIGN KEY ("audience_id") REFERENCES "ticket_audiences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_ticket_price_id_fkey" FOREIGN KEY ("ticket_price_id") REFERENCES "ticket_prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_audience_id_fkey" FOREIGN KEY ("audience_id") REFERENCES "ticket_audiences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_used_by_id_fkey" FOREIGN KEY ("used_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_scans" ADD CONSTRAINT "ticket_scans_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_scans" ADD CONSTRAINT "ticket_scans_scanned_by_id_fkey" FOREIGN KEY ("scanned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_scans" ADD CONSTRAINT "ticket_scans_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "gates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_hero_media_id_fkey" FOREIGN KEY ("hero_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_hero_media_id_fkey" FOREIGN KEY ("hero_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_media" ADD CONSTRAINT "restaurant_media_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_media" ADD CONSTRAINT "restaurant_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_pdf_media_id_fkey" FOREIGN KEY ("pdf_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_requests" ADD CONSTRAINT "reservation_requests_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_requests" ADD CONSTRAINT "reservation_requests_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
