ALTER TABLE "invoice" ADD COLUMN "invoice_number" text;--> statement-breakpoint
CREATE INDEX "invoice_invoice_number_index" ON "invoice" USING btree ("invoice_number");