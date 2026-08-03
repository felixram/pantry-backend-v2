CREATE TABLE "count_sort_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"product_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "count_sort_order_tenant_id_location_id_category_id_product_id_unique" UNIQUE("tenant_id","location_id","category_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "count_sort_order" ADD CONSTRAINT "count_sort_order_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_sort_order" ADD CONSTRAINT "count_sort_order_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_sort_order" ADD CONSTRAINT "count_sort_order_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_sort_order" ADD CONSTRAINT "count_sort_order_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "count_sort_order_tenant_id_location_id_index" ON "count_sort_order" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE INDEX "count_sort_order_category_id_index" ON "count_sort_order" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "count_sort_order_product_id_index" ON "count_sort_order" USING btree ("product_id");