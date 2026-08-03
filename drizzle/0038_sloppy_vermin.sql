ALTER TABLE "location" ADD COLUMN "inbound_email_slug" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_location_id_index" ON "invoice" USING btree ("location_id");--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_inbound_email_slug_unique" UNIQUE("inbound_email_slug");