-- Multi-tenancy migration
-- This migration handles existing data by creating a default tenant

-- Step 1: Create tenant table
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" varchar(20) DEFAULT 'FREE' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "tenant_slug_index" ON "tenant" USING btree ("slug");
--> statement-breakpoint

-- Step 2: Insert default tenant for existing data
INSERT INTO "tenant" ("id", "name", "slug", "plan")
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default', 'FREE');
--> statement-breakpoint

-- Step 3: Drop constraints that will be recreated
ALTER TABLE "category" DROP CONSTRAINT IF EXISTS "category_name_unique";
--> statement-breakpoint
ALTER TABLE "po_counter" DROP CONSTRAINT IF EXISTS "po_counter_year_unique";
--> statement-breakpoint

-- Step 4: Add tenant_id columns as nullable first
ALTER TABLE "category" ADD COLUMN "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "po_counter" ADD COLUMN "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "stock" ADD COLUMN "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD COLUMN "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "invitation_token" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "invitation_expires_at" timestamp;
--> statement-breakpoint

-- Step 5: Set all existing rows to default tenant
UPDATE "category" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
--> statement-breakpoint
UPDATE "location" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
--> statement-breakpoint
UPDATE "po_counter" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
--> statement-breakpoint
UPDATE "product" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
--> statement-breakpoint
UPDATE "purchase_order" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
--> statement-breakpoint
UPDATE "stock" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
--> statement-breakpoint
UPDATE "stock_movement" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
--> statement-breakpoint
UPDATE "supplier" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
--> statement-breakpoint
UPDATE "user" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
--> statement-breakpoint

-- Step 6: Make tenant_id columns NOT NULL
ALTER TABLE "category" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "location" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "po_counter" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "product" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_order" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_movement" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "supplier" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint

-- Step 7: Add foreign key constraints
ALTER TABLE "category" ADD CONSTRAINT "category_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "po_counter" ADD CONSTRAINT "po_counter_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock" ADD CONSTRAINT "stock_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Step 8: Add indexes
CREATE INDEX "category_tenant_id_index" ON "category" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "location_tenant_id_index" ON "location" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "po_counter_tenant_id_index" ON "po_counter" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "product_tenant_id_index" ON "product" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "purchase_order_tenant_id_index" ON "purchase_order" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "stock_tenant_id_index" ON "stock" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "stock_movement_tenant_id_index" ON "stock_movement" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "supplier_tenant_id_index" ON "supplier" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "user_tenant_id_index" ON "user" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "user_invitation_token_index" ON "user" USING btree ("invitation_token");
--> statement-breakpoint

-- Step 9: Add unique constraints
ALTER TABLE "po_counter" ADD CONSTRAINT "po_counter_year_tenant_id_unique" UNIQUE("year","tenant_id");
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_invitation_token_unique" UNIQUE("invitation_token");
