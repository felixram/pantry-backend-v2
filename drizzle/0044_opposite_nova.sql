CREATE TABLE "product_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"alias_name" text NOT NULL,
	"product_id" uuid NOT NULL,
	"source_invoice_item_id" uuid,
	"use_count" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"total_invoices_processed" integer DEFAULT 0 NOT NULL,
	"total_items_processed" integer DEFAULT 0 NOT NULL,
	"has_discount_column" boolean,
	"typical_discount_label" text,
	"default_tax_behavior" varchar(20),
	"food_items_exempt" boolean,
	"tax_marker_style" text,
	"known_products" jsonb,
	"prompt_context" text,
	"product_match_accuracy" real,
	"price_extraction_accuracy" real,
	"qty_extraction_accuracy" real,
	"overall_accuracy" real,
	"last_rebuilt_at" timestamp with time zone,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_item" ADD COLUMN "product_match_correct" boolean;--> statement-breakpoint
ALTER TABLE "invoice_item" ADD COLUMN "price_extraction_correct" boolean;--> statement-breakpoint
ALTER TABLE "invoice_item" ADD COLUMN "qty_extraction_correct" boolean;--> statement-breakpoint
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_source_invoice_item_id_invoice_item_id_fk" FOREIGN KEY ("source_invoice_item_id") REFERENCES "public"."invoice_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_profile" ADD CONSTRAINT "supplier_invoice_profile_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_profile" ADD CONSTRAINT "supplier_invoice_profile_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_alias_tenant_supplier_name_unique" ON "product_alias" USING btree ("tenant_id","supplier_id",lower("alias_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_profile_tenant_supplier_unique" ON "supplier_invoice_profile" USING btree ("tenant_id","supplier_id");