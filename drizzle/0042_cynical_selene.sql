CREATE TABLE "tax_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate" real NOT NULL,
	"type" varchar(20) NOT NULL,
	"is_default" boolean DEFAULT false,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "is_tax_exempt" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "default_purchase_tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "default_sales_tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "is_tax_exempt" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "subtotal" real;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "tax_amount" real;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "tax_rate_applied" real;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "total" real;--> statement-breakpoint
ALTER TABLE "invoice_item" ADD COLUMN "is_taxable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_item" ADD COLUMN "extracted_tax_amount" real;--> statement-breakpoint
ALTER TABLE "invoice_item" ADD COLUMN "confirmed_tax_amount" real;--> statement-breakpoint
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_rate_tenant_id_index" ON "tax_rate" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tax_rate_type_index" ON "tax_rate" USING btree ("type");--> statement-breakpoint
CREATE INDEX "tax_rate_deletedAt_index" ON "tax_rate" USING btree ("deletedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rate_tenant_name_unique" ON "tax_rate" USING btree ("tenant_id","name") WHERE "deletedAt" IS NULL;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_tax_rate_id_tax_rate_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_default_purchase_tax_rate_id_tax_rate_id_fk" FOREIGN KEY ("default_purchase_tax_rate_id") REFERENCES "public"."tax_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_default_sales_tax_rate_id_tax_rate_id_fk" FOREIGN KEY ("default_sales_tax_rate_id") REFERENCES "public"."tax_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_tax_rate_id_tax_rate_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rate"("id") ON DELETE no action ON UPDATE no action;