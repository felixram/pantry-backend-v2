CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_email" text,
	"from_name" text,
	"subject" text,
	"received_at" timestamp with time zone,
	"resend_message_id" text,
	"original_file_url" text,
	"original_file_name" text,
	"original_file_type" text,
	"extracted_data" jsonb,
	"extraction_confidence" real,
	"matched_supplier_id" uuid,
	"matched_purchase_order_id" uuid,
	"status" varchar(30) DEFAULT 'PENDING' NOT NULL,
	"processing_error" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "invoice_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"extracted_name" text,
	"extracted_sku" text,
	"extracted_qty" real,
	"extracted_unit_price" real,
	"extracted_unit" text,
	"extracted_line_total" real,
	"matched_product_id" uuid,
	"match_confidence" real,
	"match_method" varchar(20),
	"matched_po_item_id" uuid,
	"has_qty_discrepancy" boolean DEFAULT false NOT NULL,
	"has_price_discrepancy" boolean DEFAULT false NOT NULL,
	"qty_discrepancy_amount" real,
	"price_discrepancy_amount" real,
	"confirmed_product_id" uuid,
	"confirmed_qty" real,
	"confirmed_unit_price" real,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_invoice_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inbound_email_address" text NOT NULL,
	"allowed_sender_domains" text[],
	"default_location_id" uuid,
	"auto_match_enabled" boolean DEFAULT true NOT NULL,
	"require_po_match" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_invoice_config_inbound_email_address_unique" UNIQUE("inbound_email_address")
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_matched_supplier_id_supplier_id_fk" FOREIGN KEY ("matched_supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_matched_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("matched_purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_item" ADD CONSTRAINT "invoice_item_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_item" ADD CONSTRAINT "invoice_item_matched_product_id_product_id_fk" FOREIGN KEY ("matched_product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_item" ADD CONSTRAINT "invoice_item_matched_po_item_id_purchase_order_item_id_fk" FOREIGN KEY ("matched_po_item_id") REFERENCES "public"."purchase_order_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_item" ADD CONSTRAINT "invoice_item_confirmed_product_id_product_id_fk" FOREIGN KEY ("confirmed_product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" ADD CONSTRAINT "tenant_invoice_config_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invoice_config" ADD CONSTRAINT "tenant_invoice_config_default_location_id_location_id_fk" FOREIGN KEY ("default_location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_tenant_id_index" ON "invoice" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoice_status_index" ON "invoice" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoice_matched_supplier_id_index" ON "invoice" USING btree ("matched_supplier_id");--> statement-breakpoint
CREATE INDEX "invoice_matched_purchase_order_id_index" ON "invoice" USING btree ("matched_purchase_order_id");--> statement-breakpoint
CREATE INDEX "invoice_resend_message_id_index" ON "invoice" USING btree ("resend_message_id");--> statement-breakpoint
CREATE INDEX "invoice_deletedAt_index" ON "invoice" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "invoice_item_invoice_id_index" ON "invoice_item" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_item_matched_product_id_index" ON "invoice_item" USING btree ("matched_product_id");--> statement-breakpoint
CREATE INDEX "invoice_item_matched_po_item_id_index" ON "invoice_item" USING btree ("matched_po_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_invoice_config_tenant_unique" ON "tenant_invoice_config" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_invoice_config_inbound_email_address_index" ON "tenant_invoice_config" USING btree ("inbound_email_address");