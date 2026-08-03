CREATE TABLE "product_unit_conversion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_name" text NOT NULL,
	"conversion_factor" real DEFAULT 1 NOT NULL,
	"is_base_unit" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_unit_conversion" ADD CONSTRAINT "product_unit_conversion_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_unit_conversion" ADD CONSTRAINT "product_unit_conversion_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_unit_conversion_product_id_index" ON "product_unit_conversion" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_unit_conversion_tenant_id_index" ON "product_unit_conversion" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_unit_conversion_product_id_unit_name_index" ON "product_unit_conversion" USING btree ("product_id","unit_name");