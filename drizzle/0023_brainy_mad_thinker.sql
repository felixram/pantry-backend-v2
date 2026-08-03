CREATE TABLE "inventory_count_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"week_identifier" varchar(10) NOT NULL,
	"completed_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_count_session_tenant_id_location_id_week_identifier_unique" UNIQUE("tenant_id","location_id","week_identifier")
);
--> statement-breakpoint
CREATE TABLE "inventory_count_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"stock_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"expected_qty" real NOT NULL,
	"counted_qty" real,
	"last_synced_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_count_session" ADD CONSTRAINT "inventory_count_session_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_session" ADD CONSTRAINT "inventory_count_session_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_session" ADD CONSTRAINT "inventory_count_session_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_entry" ADD CONSTRAINT "inventory_count_entry_session_id_inventory_count_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inventory_count_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_entry" ADD CONSTRAINT "inventory_count_entry_stock_id_stock_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stock"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_entry" ADD CONSTRAINT "inventory_count_entry_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_count_session_tenant_id_index" ON "inventory_count_session" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_count_session_location_id_index" ON "inventory_count_session" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "inventory_count_session_week_identifier_index" ON "inventory_count_session" USING btree ("week_identifier");--> statement-breakpoint
CREATE INDEX "inventory_count_session_status_index" ON "inventory_count_session" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inventory_count_entry_session_id_index" ON "inventory_count_entry" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "inventory_count_entry_stock_id_index" ON "inventory_count_entry" USING btree ("stock_id");--> statement-breakpoint
CREATE INDEX "inventory_count_entry_product_id_index" ON "inventory_count_entry" USING btree ("product_id");