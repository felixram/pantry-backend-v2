DROP INDEX "invoice_tenant_message_unique";--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "resend_email_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_tenant_email_id_unique" ON "invoice" USING btree ("tenant_id","resend_email_id");